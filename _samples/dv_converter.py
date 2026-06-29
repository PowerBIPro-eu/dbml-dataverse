#!/usr/bin/env python3
"""
dv_converter.py — Dataverse solution XML → .dv.dbml converter

Produces per-entity .dv.dbml files using the extended Dataverse DBML syntax
supported by the dbml-dataverse fork.

Usage:
    # Single solution (writes per-entity files):
    python dv_converter.py /path/to/solution --output ./output [--colors colors.json]

    # Multiple layered solutions (merged, source_solution stamped on every element):
    python dv_converter.py /path/to/Core /path/to/Sales /path/to/Service --output ./output

    # Override solution display names:
    python dv_converter.py ./Core ./Sales --output ./out --solution-names Core,Sales

    # Single entity file (writes to stdout):
    python dv_converter.py /path/to/Entity.xml
"""

import argparse
import xml.etree.ElementTree as ET
import sys
import os
import io
import json
from pathlib import Path
from collections import defaultdict

# Force UTF-8 on stdout/stderr (Windows console may default to cp1252)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ── Configuration ──────────────────────────────────────────────────────────

EXCLUDED_COLUMNS = {
    'timezoneruleversionnumber', 'utcconversiontimezonecode',
    'importsequencenumber', 'overriddencreatedon', 'processid',
    'stageid', 'traversedpath', 'versionnumber', 'organizationid',
    'createdby', 'createdon', 'createdonbehalfby',
    'modifiedby', 'modifiedon', 'modifiedonbehalfby',
    'ownerid', 'owningteam', 'owninguser',
}

EXCLUDED_ENTITIES = {
    'BusinessUnit', 'Role', 'SystemUser', 'Team', 'TransactionCurrency',
}

SOURCE_TYPE_MAP = {'0': 'simple', '1': 'calculated', '2': 'rollup', '4': 'formula'}

# (XML tag, DBML setting key) for all 7 cascade behaviors
CASCADE_ACTIONS = [
    ('CascadeDelete',    'delete'),
    ('CascadeAssign',    'cascade_assign'),
    ('CascadeArchive',   'cascade_archive'),
    ('CascadeReparent',  'cascade_reparent'),
    ('CascadeShare',     'cascade_share'),
    ('CascadeUnshare',   'cascade_unshare'),
    ('CascadeRollupView','cascade_rollupview'),
]

# ── String helpers ─────────────────────────────────────────────────────────

def _q(s: str) -> str:
    """Escape single quotes and backslashes for DBML string settings."""
    if not s:
        return ''
    return s.replace('\\', '\\\\').replace("'", "\\'")


def _get_en_label(parent_el, container_tag: str) -> str:
    """Extract English (1033) description from <container_tag>/<label>."""
    container = parent_el.find(container_tag)
    if container is None:
        return ''
    for label in container.findall('label'):
        if label.get('languagecode') == '1033':
            return label.get('description', '') or ''
    return ''


def _get_en_displayname(el) -> str:
    """Extract English display name from <displaynames>/<displayname>."""
    dn_el = el.find('displaynames')
    if dn_el is None:
        return ''
    for dn in dn_el.findall('displayname'):
        if dn.get('languagecode') == '1033':
            return dn.get('description', '') or ''
    return ''


def _get_en_description(el) -> str:
    """Extract English description from <Descriptions>/<Description>."""
    desc_el = el.find('Descriptions')
    if desc_el is None:
        return ''
    for d in desc_el.findall('Description'):
        if d.get('languagecode') == '1033':
            return d.get('description', '') or ''
    return ''


def _map_ownership(raw: str) -> str:
    r = (raw or '').strip().lower()
    if r in ('userowned', '2', '3'):
        return 'UserOwned'
    if r in ('teamowned', '8'):
        return 'TeamOwned'
    if r in ('organizationowned', 'orgowned', '4', '6'):
        return 'OrganizationOwned'
    return 'None'


# ── OptionSet emitters ─────────────────────────────────────────────────────

def emit_option_set(f, name: str, display_name: str, description: str,
                    values: list, is_global: bool = False, source_solution: str | None = None):
    """OptionSet name [display_name: '...', is_global: true] { int [label: '...'] ... }"""
    parts = []
    if display_name:
        parts.append(f"display_name: '{_q(display_name)}'")
    if is_global:
        parts.append('is_global: true')
    if description:
        parts.append(f"description: '{_q(description)}'")
    if source_solution:
        parts.append(f"source_solution: '{_q(source_solution)}'")
    bracket = f' [{", ".join(parts)}]' if parts else ''
    print(f'OptionSet {name}{bracket} {{', file=f)
    for val, label in values:
        print(f"  {val} [label: '{_q(label)}']", file=f)
    print('}', file=f)
    print('', file=f)


def emit_state_option_set(f, name: str, states: list):
    """StateOptionSet name { int [label: '...', invariant_name: '...', default_status: n] }"""
    print(f'StateOptionSet {name} {{', file=f)
    for val, label, inv_name, default_status in states:
        parts = [f"label: '{_q(label)}'"]
        if inv_name:
            parts.append(f"invariant_name: '{_q(inv_name)}'")
        if default_status is not None:
            parts.append(f'default_status: {default_status}')
        print(f'  {val} [{", ".join(parts)}]', file=f)
    print('}', file=f)
    print('', file=f)


def emit_status_option_set(f, name: str, statuses: list):
    """StatusOptionSet name { int [label: '...', state: n, color: '#...'] }"""
    print(f'StatusOptionSet {name} {{', file=f)
    for val, label, state, color in statuses:
        parts = [f"label: '{_q(label)}'"]
        if state is not None:
            parts.append(f'state: {state}')
        if color:
            parts.append(f"color: '{color}'")
        print(f'  {val} [{", ".join(parts)}]', file=f)
    print('}', file=f)
    print('', file=f)


def emit_bit_option_set(f, name: str, true_label: str, false_label: str):
    """BitOptionSet name { 1 [label: '...'] 0 [label: '...'] }"""
    print(f'BitOptionSet {name} {{', file=f)
    print(f"  1 [label: '{_q(true_label)}']", file=f)
    print(f"  0 [label: '{_q(false_label)}']", file=f)
    print('}', file=f)
    print('', file=f)


# ── Global OptionSet parser ────────────────────────────────────────────────

def parse_global_optionset(file_path: str) -> dict | None:
    """Parse a global OptionSet from OptionSets/<name>.xml."""
    try:
        root = ET.parse(file_path).getroot()
    except Exception as e:
        print(f'// Warning: could not parse {file_path}: {e}', file=sys.stderr)
        return None

    name = root.get('Name')
    if not name:
        return None

    display_name = _get_en_displayname(root)
    description = _get_en_description(root)

    values = []
    options_el = root.find('options')
    if options_el is not None:
        for opt in options_el.findall('option'):
            raw_val = opt.get('value')
            if raw_val is None:
                continue
            try:
                int_val = int(raw_val)
            except ValueError:
                continue
            label = _get_en_label(opt, 'labels')
            if label:
                values.append((int_val, label))

    if not values:
        return None

    return {
        'name': name,
        'display_name': display_name,
        'description': description,
        'values': values,
        'is_global': True,
    }


# ── Inline OptionSet parser ────────────────────────────────────────────────

def _parse_inline_optionset(os_el, fallback_type: str) -> dict | None:
    """Parse an inline <optionset> element within an attribute."""
    os_name = os_el.get('Name', '')
    os_type = (os_el.findtext('OptionSetType') or fallback_type).lower()
    display_name = _get_en_displayname(os_el)
    description = _get_en_description(os_el)

    if os_type == 'state':
        states = []
        states_el = os_el.find('states')
        for state_el in (states_el.findall('state') if states_el is not None else []):
            val_str = state_el.get('value')
            if val_str is None:
                continue
            inv = state_el.get('invariantname', '')
            ds_str = state_el.get('defaultstatus')
            label = _get_en_label(state_el, 'labels')
            try:
                val = int(val_str)
                ds = int(ds_str) if ds_str else None
            except ValueError:
                continue
            states.append((val, label, inv, ds))
        return {
            'name': os_name, 'type': 'state',
            'display_name': display_name, 'description': description,
            'states': states,
        }

    elif os_type == 'status':
        statuses = []
        statuses_el = os_el.find('statuses')
        for s_el in (statuses_el.findall('status') if statuses_el is not None else []):
            val_str = s_el.get('value')
            if val_str is None:
                continue
            state_str = s_el.get('state')
            color = s_el.get('Color', '')
            label = _get_en_label(s_el, 'labels')
            try:
                val = int(val_str)
                state_int = int(state_str) if state_str is not None else None
            except ValueError:
                continue
            statuses.append((val, label, state_int, color or ''))
        return {
            'name': os_name, 'type': 'status',
            'display_name': display_name, 'description': description,
            'statuses': statuses,
        }

    elif os_type == 'bit':
        true_label = false_label = ''
        options_el = os_el.find('options')
        for opt in (options_el.findall('option') if options_el is not None else []):
            v = opt.get('value')
            lbl = _get_en_label(opt, 'labels')
            if v == '1':
                true_label = lbl
            elif v == '0':
                false_label = lbl
        return {
            'name': os_name, 'type': 'bit',
            'display_name': display_name, 'description': description,
            'true_label': true_label, 'false_label': false_label,
        }

    else:  # picklist / multiselectpicklist
        values = []
        options_el = os_el.find('options')
        for opt in (options_el.findall('option') if options_el is not None else []):
            raw_val = opt.get('value')
            if raw_val is None:
                continue
            try:
                int_val = int(raw_val)
            except ValueError:
                continue
            label = _get_en_label(opt, 'labels')
            if label:
                values.append((int_val, label))
        return {
            'name': os_name, 'type': 'picklist',
            'display_name': display_name, 'description': description,
            'values': values,
        }


# ── Entity XML parser ──────────────────────────────────────────────────────

def parse_entity_xml(file_path: str) -> dict | None:
    try:
        root = ET.parse(file_path).getroot()
    except Exception as e:
        print(f'// Error parsing {file_path}: {e}', file=sys.stderr)
        return None

    entity_info = root.find('EntityInfo/entity')
    if entity_info is None:
        print(f'// Skipping {os.path.basename(os.path.dirname(file_path))}: no EntityInfo/entity', file=sys.stderr)
        return None

    entity_name = entity_info.get('Name')
    if not entity_name:
        return None
    if entity_name in EXCLUDED_ENTITIES:
        print(f'// Skipping {entity_name}: explicitly excluded', file=sys.stderr)
        return None
    if entity_info.findtext('IsBPFEntity') == '1':
        print(f'// Skipping {entity_name}: BPF entity', file=sys.stderr)
        return None

    # Entity-level metadata
    display_name = ''
    for ln in (entity_info.find('LocalizedNames') or []):
        if ln.get('languagecode') == '1033':
            display_name = ln.get('description', '')
            break

    description = _get_en_description(entity_info)
    ownership = _map_ownership(entity_info.findtext('OwnershipTypeMask') or '')

    is_audit_enabled = entity_info.findtext('IsAuditEnabled') == '1'
    is_activity = entity_info.findtext('IsActivity') == '1'
    is_activity_party = entity_info.findtext('IsActivityParty') == '1'

    # Attributes
    local_option_sets: dict = {}   # os_name -> os_data dict
    global_optionset_refs: set = set()
    attributes = []

    attrs_el = entity_info.find('attributes')
    if attrs_el is not None:
        for attr in attrs_el.findall('attribute'):
            logical_name = attr.findtext('LogicalName') or attr.findtext('Name') or ''
            if logical_name.lower() in EXCLUDED_COLUMNS:
                continue

            physical_name = attr.get('PhysicalName') or logical_name
            attr_type = attr.findtext('Type') or ''
            required_level = attr.findtext('RequiredLevel') or 'none'
            source_type = SOURCE_TYPE_MAP.get(attr.findtext('SourceType') or '0', 'simple')
            auto_number = (attr.findtext('AutoNumberFormat') or '').strip()
            fmt = (attr.findtext('Format') or '').strip()
            max_length = attr.findtext('MaxLength')
            attr_display = _get_en_displayname(attr)
            attr_desc = _get_en_description(attr)

            # Always use logical_name as the column identifier (lowercase, OData-compatible)
            col_name = logical_name

            # Build the DBML type string (add length for nvarchar/ntext)
            dbml_type = attr_type
            if attr_type == 'nvarchar' and max_length:
                dbml_type = f'nvarchar({max_length})'
            elif attr_type == 'ntext' and max_length and int(max_length) < 500000:
                # ntext with typical max — still just ntext
                dbml_type = 'ntext'

            option_set_name = None  # for option_set: '...' column setting
            custom_bit = False

            # Inline optionset (state, status, local picklist, bit)
            os_el = attr.find('optionset')
            if os_el is not None:
                os_data = _parse_inline_optionset(os_el, attr_type)
                if os_data:
                    os_name = os_data['name']
                    os_type_str = os_data['type']
                    if os_type_str == 'bit':
                        tl = os_data['true_label'].strip().lower()
                        fl = os_data['false_label'].strip().lower()
                        if {tl, fl} <= {'yes', 'no', 'true', 'false'}:
                            pass  # default labels — no BitOptionSet, no option_set link
                        else:
                            local_option_sets[os_name] = os_data
                            option_set_name = os_name
                            custom_bit = True
                    else:
                        local_option_sets[os_name] = os_data
                        option_set_name = os_name

            # Global OptionSet reference (picklist with no local block)
            if option_set_name is None:
                global_ref = (attr.findtext('OptionSetName') or '').strip()
                if global_ref:
                    option_set_name = global_ref
                    global_optionset_refs.add(global_ref)

            attributes.append({
                'name': col_name,
                'logical_name': logical_name,
                'type': dbml_type,
                'required': required_level,
                'is_pk': attr_type == 'primarykey',
                'source_type': source_type,
                'auto_number': auto_number,
                'format': fmt,
                'display_name': attr_display,
                'description': attr_desc,
                'option_set_name': option_set_name,
                'lookup_targets': [],  # filled in second pass
            })

    # PK check
    if not any(a['is_pk'] for a in attributes):
        print(f'// Skipping {entity_name}: no primary key', file=sys.stderr)
        return None

    # Alternate keys → indexes
    keys = []
    ek_el = entity_info.find('EntityKeys')
    if ek_el is not None:
        for key_el in ek_el.findall('EntityKey'):
            key_name = key_el.findtext('Name') or ''
            cols = [a.text for a in (key_el.find('EntityKeyAttributes') or []).findall('AttributeName') if a.text]
            if cols:
                keys.append({'name': key_name, 'columns': cols})

    return {
        'name': entity_name,
        'display_name': display_name,
        'description': description,
        'ownership': ownership,
        'is_audit_enabled': is_audit_enabled,
        'is_activity': is_activity,
        'is_activity_party': is_activity_party,
        'attributes': attributes,
        'local_option_sets': local_option_sets,
        'global_optionset_refs': global_optionset_refs,
        'keys': keys,
    }


# ── Relationship parser ────────────────────────────────────────────────────

def parse_relationships(folder_path: str) -> list:
    """Parse all EntityRelationship XML files in a folder."""
    if not folder_path or not os.path.exists(folder_path):
        return []

    results = []
    files = [fn for fn in os.listdir(folder_path) if fn.endswith('.xml')]
    for fn in files:
        fp = os.path.join(folder_path, fn)
        try:
            root = ET.parse(fp).getroot()
        except Exception:
            continue

        # Root might be a single EntityRelationship or a container
        rels = root.findall('EntityRelationship') or ([root] if root.tag == 'EntityRelationship' else [])
        for rel in rels:
            rel_name = rel.get('Name', '')
            rel_type = rel.findtext('EntityRelationshipType') or ''

            if rel_type == 'OneToMany':
                referenced  = rel.findtext('ReferencedEntityName')  or ''
                referencing = rel.findtext('ReferencingEntityName') or ''
                fk_col      = rel.findtext('ReferencingAttributeName') or ''

                cascades = {}
                for xml_tag, setting_key in CASCADE_ACTIONS:
                    val = rel.findtext(xml_tag)
                    if val:
                        cascades[setting_key] = val

                is_hierarchical = rel.findtext('IsHierarchical') == '1'

                nav_many = nav_one = ''
                nav_pane_display = nav_pane_area = ''
                nav_pane_order = None
                roles_el = rel.find('EntityRelationshipRoles')
                for role_el in (roles_el.findall('EntityRelationshipRole') if roles_el is not None else []):
                    role_type = role_el.findtext('RelationshipRoleType')
                    nav_name  = role_el.findtext('NavigationPropertyName') or ''
                    if role_type == '1':   # many/child side
                        nav_many = nav_name
                        nav_pane_display = role_el.findtext('NavPaneDisplayOption') or ''
                        nav_pane_area    = role_el.findtext('NavPaneArea') or ''
                        order_str = role_el.findtext('NavPaneOrder')
                        if order_str:
                            try:
                                nav_pane_order = int(order_str)
                            except ValueError:
                                pass
                    elif role_type == '0':  # one/parent side
                        nav_one = nav_name

                results.append({
                    'type': 'OneToMany',
                    'name': rel_name,
                    'referenced': referenced,
                    'referencing': referencing,
                    'fk_col': fk_col,
                    'cascades': cascades,
                    'is_hierarchical': is_hierarchical,
                    'nav_many': nav_many,
                    'nav_one': nav_one,
                    'nav_pane_display': nav_pane_display,
                    'nav_pane_area': nav_pane_area,
                    'nav_pane_order': nav_pane_order,
                })

            elif rel_type == 'ManyToMany':
                first    = rel.findtext('Entity1LogicalName') or rel.findtext('FirstEntityName') or ''
                second   = rel.findtext('Entity2LogicalName') or rel.findtext('SecondEntityName') or ''
                intersect = rel.findtext('IntersectEntityName') or ''
                results.append({
                    'type': 'ManyToMany',
                    'name': rel_name,
                    'first': first,
                    'second': second,
                    'intersect': intersect,
                })

    return results


# ── DBML emitters ──────────────────────────────────────────────────────────

def emit_entity_file(f, entity: dict, pk_map: dict, header_color: str | None,
                     rels_as_parent: list):
    """Write the full .dv.dbml content for one entity."""

    entity_name = entity['name']

    # ── Header ────────────────────────────────────────────────────────────
    print(f'// Generated from Dataverse solution XML', file=f)
    print(f'// Entity: {entity_name}', file=f)
    print('', file=f)

    # ── Local option sets (state, status, local picklist, custom bit) ─────
    for os_data in entity['local_option_sets'].values():
        t = os_data['type']
        if t == 'state':
            emit_state_option_set(f, os_data['name'], os_data['states'])
        elif t == 'status':
            emit_status_option_set(f, os_data['name'], os_data['statuses'])
        elif t == 'bit':
            emit_bit_option_set(f, os_data['name'], os_data['true_label'], os_data['false_label'])
        else:
            emit_option_set(f, os_data['name'], os_data.get('display_name', ''),
                            os_data.get('description', ''), os_data['values'], is_global=False,
                            source_solution=os_data.get('source_solution'))

    # ── Table ─────────────────────────────────────────────────────────────
    table_settings = []
    if entity['display_name']:
        table_settings.append(f"display_name: '{_q(entity['display_name'])}'")
    if entity['ownership'] not in ('None', ''):
        table_settings.append(f"ownership: {entity['ownership']}")
    if entity['is_audit_enabled']:
        table_settings.append('is_audit_enabled: true')
    if entity['is_activity']:
        table_settings.append('is_activity: true')
    if entity['is_activity_party']:
        table_settings.append('is_activity_party: true')
    if entity['description']:
        table_settings.append(f"description: '{_q(entity['description'])}'")
    if entity.get('source_solution'):
        table_settings.append(f"source_solution: '{_q(entity['source_solution'])}'")
    color = header_color or '#175e7a'
    table_settings.append(f'headercolor: {color}')

    bracket = f' [{", ".join(table_settings)}]' if table_settings else ''
    print(f'Table {entity_name}{bracket} {{', file=f)

    for attr in entity['attributes']:
        col_settings = []

        if attr['is_pk']:
            col_settings.append('pk')
        if attr['display_name']:
            col_settings.append(f"display_name: '{_q(attr['display_name'])}'")

        col_settings.append(f"required: {attr['required']}")

        if attr['source_type'] != 'simple':
            col_settings.append(f"source_type: {attr['source_type']}")
        if attr['auto_number']:
            col_settings.append(f"auto_number: '{_q(attr['auto_number'])}'")
        if attr['format']:
            col_settings.append(f"format: '{attr['format']}'")
        if attr['option_set_name']:
            col_settings.append(f"option_set: '{attr['option_set_name']}'")
        if attr['lookup_targets']:
            col_settings.append(f"targets: '{', '.join(attr['lookup_targets'])}'")

        # Short single-line descriptions as note
        desc = attr['description']
        if desc and '\n' not in desc and len(desc) <= 100:
            col_settings.append(f"note: '{_q(desc)}'")
        if attr.get('source_solution'):
            col_settings.append(f"source_solution: '{_q(attr['source_solution'])}'")

        settings_str = f' [{", ".join(col_settings)}]' if col_settings else ''
        print(f'  {attr["name"]} {attr["type"]}{settings_str}', file=f)

    if entity['keys']:
        print('', file=f)
        print('  indexes {', file=f)
        for key in entity['keys']:
            cols = ', '.join(key['columns'])
            print(f"    ({cols}) [name: '{key['name']}', unique]", file=f)
        print('  }', file=f)

    print('}', file=f)
    print('', file=f)

    # ── Relationships where this entity is the parent (one side) ──────────
    for rel in rels_as_parent:
        emit_ref(f, rel, pk_map)


def emit_ref(f, rel: dict, pk_map: dict):
    """Emit a Ref block for a 1:N or N:N relationship."""
    if rel['type'] == 'ManyToMany':
        first   = rel['first']
        second  = rel['second']
        pk_first  = pk_map.get(first,  f'{first.lower()}id')
        pk_second = pk_map.get(second, f'{second.lower()}id')
        rel_name = rel['name'] or f'{first}_{second}'
        settings = []
        if rel['intersect']:
            settings.append(f"  intersect_entity: '{rel['intersect']}'")
        if rel.get('source_solution'):
            settings.append(f"  source_solution: '{_q(rel['source_solution'])}'")
        if settings:
            print(f'Ref {rel_name} [', file=f)
            for s in settings:
                print(s, file=f)
            print(f']: {first}.{pk_first} <> {second}.{pk_second}', file=f)
        else:
            print(f'Ref {rel_name}: {first}.{pk_first} <> {second}.{pk_second}', file=f)
        print('', file=f)
        return

    # OneToMany
    referenced  = rel['referenced']
    referencing = rel['referencing']
    fk_col      = rel['fk_col']
    pk_col      = pk_map.get(referenced, f'{referenced.lower()}id')
    rel_name    = rel['name']

    setting_lines = []
    cascades = rel['cascades']

    # delete: first (maps CascadeDelete)
    if 'delete' in cascades:
        setting_lines.append(f"  delete: {cascades['delete']}")
    # remaining cascade settings
    for _, key in CASCADE_ACTIONS[1:]:
        if key in cascades:
            setting_lines.append(f"  {key}: {cascades[key]}")
    if rel['is_hierarchical']:
        setting_lines.append('  is_hierarchical: true')
    if rel['nav_many']:
        setting_lines.append(f"  nav_many: '{rel['nav_many']}'")
    if rel['nav_one']:
        setting_lines.append(f"  nav_one: '{rel['nav_one']}'")
    if rel['nav_pane_display']:
        setting_lines.append(f"  nav_pane_display: {rel['nav_pane_display']}")
    if rel['nav_pane_area']:
        setting_lines.append(f"  nav_pane_area: {rel['nav_pane_area']}")
    if rel['nav_pane_order'] is not None:
        setting_lines.append(f"  nav_pane_order: {rel['nav_pane_order']}")
    if rel.get('source_solution'):
        setting_lines.append(f"  source_solution: '{_q(rel['source_solution'])}'")

    # Format: add commas between lines, no comma on last
    if setting_lines:
        print(f'Ref {rel_name} [', file=f)
        for i, line in enumerate(setting_lines):
            comma = ',' if i < len(setting_lines) - 1 else ''
            print(f'{line}{comma}', file=f)
        print(f']: {referenced}.{pk_col} < {referencing}.{fk_col}', file=f)
    else:
        print(f'Ref {rel_name}: {referenced}.{pk_col} < {referencing}.{fk_col}', file=f)
    print('', file=f)


# ── Multi-solution helpers ─────────────────────────────────────────────────

def derive_solution_name(path: str) -> str:
    return os.path.basename(os.path.normpath(path))


def _resolve_solution_paths(base: str) -> tuple:
    """Return (entities_path, optionsets_path|None, global_rels_path|None)."""
    for entities, optsets, rels in [
        (os.path.join(base, 'src', 'Entities'),
         os.path.join(base, 'src', 'OptionSets'),
         os.path.join(base, 'src', 'Other', 'Relationships')),
        (os.path.join(base, 'Entities'),
         os.path.join(base, 'OptionSets'),
         os.path.join(base, 'Other', 'Relationships')),
    ]:
        if os.path.exists(entities):
            return (
                entities,
                optsets if os.path.exists(optsets) else None,
                rels if os.path.exists(rels) else None,
            )
    if os.path.basename(base) == 'Entities' and os.path.exists(base):
        parent = os.path.dirname(base)
        opt = os.path.join(parent, 'OptionSets')
        rel = os.path.join(parent, 'Other', 'Relationships')
        return (base,
                opt if os.path.exists(opt) else None,
                rel if os.path.exists(rel) else None)
    raise ValueError(f'Could not find an Entities folder under: {base}')


def parse_solution(path: str, solution_name: str) -> dict:
    """Parse a single solution directory; stamps every item with source_solution."""
    entities_path, opt_path, rels_path = _resolve_solution_paths(path)

    global_option_sets: dict = {}
    if opt_path:
        for fn in sorted(os.listdir(opt_path)):
            if fn.endswith('.xml'):
                os_data = parse_global_optionset(os.path.join(opt_path, fn))
                if os_data:
                    os_data['source_solution'] = solution_name
                    global_option_sets[os_data['name']] = os_data
    print(f'[{solution_name}] Parsed {len(global_option_sets)} global option sets', file=sys.stderr)

    entities: dict = {}
    for item in sorted(os.listdir(entities_path)):
        item_path = os.path.join(entities_path, item)
        if not os.path.isdir(item_path):
            continue
        entity_xml = os.path.join(item_path, 'Entity.xml')
        if not os.path.exists(entity_xml):
            continue
        entity = parse_entity_xml(entity_xml)
        if entity:
            entity['source_solution'] = solution_name
            for attr in entity['attributes']:
                attr['source_solution'] = solution_name
            for los in entity['local_option_sets'].values():
                los['source_solution'] = solution_name
            entities[entity['name']] = entity
    print(f'[{solution_name}] Parsed {len(entities)} entities', file=sys.stderr)

    relationships: list = []
    for item in os.listdir(entities_path):
        rels_folder = os.path.join(entities_path, item, 'Relationships')
        for rel in parse_relationships(rels_folder):
            rel['source_solution'] = solution_name
            relationships.append(rel)
    if rels_path:
        for rel in parse_relationships(rels_path):
            rel['source_solution'] = solution_name
            relationships.append(rel)

    seen_names: set = set()
    unique_rels: list = []
    for rel in relationships:
        key = rel.get('name', '')
        if key and key in seen_names:
            continue
        if key:
            seen_names.add(key)
        unique_rels.append(rel)
    print(f'[{solution_name}] Parsed {len(unique_rels)} relationships', file=sys.stderr)

    return {
        'name': solution_name,
        'entities': entities,
        'global_option_sets': global_option_sets,
        'relationships': unique_rels,
    }


def merge_solutions(layers: list) -> dict:
    """Merge multiple solution layers into a single model.

    Rules:
      - Global option sets, columns, relationships: first-wins by name
      - display_name, description: last-wins
      - ownership, is_activity, is_activity_party: first-wins (structural)
      - is_audit_enabled: OR semantics (any layer enabling it wins)
    """
    entities: dict = {}
    global_option_sets: dict = {}
    relationships: list = []
    seen_rels: set = set()

    for layer in layers:
        for os_name, os_data in layer['global_option_sets'].items():
            if os_name not in global_option_sets:
                global_option_sets[os_name] = os_data

        for rel in layer['relationships']:
            rel_name = rel.get('name', '')
            if rel_name and rel_name in seen_rels:
                continue
            if rel_name:
                seen_rels.add(rel_name)
            relationships.append(rel)

        for ent_name, ent in layer['entities'].items():
            if ent_name not in entities:
                entities[ent_name] = ent
            else:
                existing = entities[ent_name]

                # Columns: first-wins
                existing_cols = {a['name'] for a in existing['attributes']}
                for attr in ent['attributes']:
                    if attr['name'] not in existing_cols:
                        existing['attributes'].append(attr)
                        existing_cols.add(attr['name'])

                # Local option sets: first-wins
                for los_name, los_data in ent['local_option_sets'].items():
                    if los_name not in existing['local_option_sets']:
                        existing['local_option_sets'][los_name] = los_data

                # Keys: first-wins
                existing_keys = {k['name'] for k in existing['keys']}
                for key in ent['keys']:
                    if key['name'] not in existing_keys:
                        existing['keys'].append(key)
                        existing_keys.add(key['name'])

                # Display metadata: last-wins
                if ent['display_name']:
                    existing['display_name'] = ent['display_name']
                if ent['description']:
                    existing['description'] = ent['description']

                # Audit: OR semantics
                if ent['is_audit_enabled']:
                    existing['is_audit_enabled'] = True

    return {
        'entities': entities,
        'global_option_sets': global_option_sets,
        'relationships': relationships,
    }


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description='Convert Dataverse solution XML to .dv.dbml')
    ap.add_argument('path', nargs='+',
                    help='Solution folder(s), src/Entities folder, or single Entity.xml')
    ap.add_argument('--output', '-o', metavar='DIR',
                    help='Output directory for .dv.dbml files (default: stdout)')
    ap.add_argument('--colors', metavar='FILE',
                    help='JSON file mapping entity names to header colors')
    ap.add_argument('--solution-names', metavar='NAMES',
                    help='Comma-separated names for each solution (in order of paths)')
    args = ap.parse_args()

    for p in args.path:
        if not os.path.exists(p):
            print(f'Error: path not found: {p}', file=sys.stderr)
            sys.exit(1)

    # Load color map
    color_map: dict = {}
    if args.colors:
        try:
            with open(args.colors, encoding='utf-8') as fh:
                color_map = json.load(fh)
        except Exception as e:
            print(f'Warning: could not load colors file: {e}', file=sys.stderr)

    # Parse optional solution-names override
    solution_names = None
    if args.solution_names:
        solution_names = [n.strip() for n in args.solution_names.split(',') if n.strip()]
        if len(solution_names) != len(args.path):
            print(f'Error: --solution-names has {len(solution_names)} entries but '
                  f'{len(args.path)} paths given.', file=sys.stderr)
            sys.exit(1)

    # ── Single entity file ────────────────────────────────────────────────
    if len(args.path) == 1 and os.path.isfile(args.path[0]):
        entity = parse_entity_xml(args.path[0])
        if entity:
            out = open(args.output, 'w', encoding='utf-8') if args.output else sys.stdout
            emit_entity_file(out, entity, {}, color_map.get(entity['name']), [])
            if args.output:
                out.close()
                print(f'Written: {args.output}', file=sys.stderr)
        return

    # ── Solution directory/directories ────────────────────────────────────
    layers = []
    for i, p in enumerate(args.path):
        name = (solution_names[i] if solution_names else None) or derive_solution_name(p)
        layers.append(parse_solution(p, name))

    model = merge_solutions(layers)
    all_entities = model['entities']
    global_option_sets = model['global_option_sets']
    all_rels = model['relationships']

    print(f'Merged: {len(all_entities)} entities, {len(global_option_sets)} global option sets, '
          f'{len(all_rels)} relationships', file=sys.stderr)

    # pk_map
    pk_map: dict = {}
    for entity in all_entities.values():
        pk = next((a['name'] for a in entity['attributes'] if a['is_pk']), None)
        if pk:
            pk_map[entity['name']] = pk

    # Second pass: populate lookup_targets from relationship data
    target_map: dict = {}
    for rel in all_rels:
        if rel['type'] == 'OneToMany' and rel['fk_col']:
            target_map[(rel['referencing'], rel['fk_col'])] = rel['referenced']

    for entity in all_entities.values():
        for attr in entity['attributes']:
            base_type = attr['type'].split('(')[0]
            if base_type in ('lookup', 'owner', 'customer'):
                target = target_map.get((entity['name'], attr['logical_name']))
                if target and target in pk_map:
                    attr['lookup_targets'] = [target]

    # Group relationships by parent entity
    rels_by_parent: dict = defaultdict(list)
    seen_nn: set = set()
    for rel in all_rels:
        if rel['type'] == 'OneToMany':
            ref = rel['referenced']
            refg = rel['referencing']
            if ref in all_entities and refg in all_entities:
                rels_by_parent[ref].append(rel)
        elif rel['type'] == 'ManyToMany':
            first = rel.get('first', '')
            second = rel.get('second', '')
            nn_key = tuple(sorted((first, second)))
            if nn_key in seen_nn:
                continue
            seen_nn.add(nn_key)
            if first in all_entities:
                rels_by_parent[first].append(rel)

    # Write output
    if args.output:
        out_dir = Path(args.output)
        out_dir.mkdir(parents=True, exist_ok=True)

        if global_option_sets:
            gos_path = out_dir / 'global_option_sets.dv.dbml'
            with open(gos_path, 'w', encoding='utf-8') as fh:
                print('// Global option sets (solution-level, shared across entities)', file=fh)
                print('', file=fh)
                for os_data in global_option_sets.values():
                    emit_option_set(fh, os_data['name'], os_data['display_name'],
                                    os_data['description'], os_data['values'], is_global=True,
                                    source_solution=os_data.get('source_solution'))
            print(f'Written: {gos_path}', file=sys.stderr)

        for entity_name, entity in all_entities.items():
            ent_path = out_dir / f'{entity_name}.dv.dbml'
            with open(ent_path, 'w', encoding='utf-8') as fh:
                emit_entity_file(fh, entity, pk_map,
                                 color_map.get(entity_name),
                                 rels_by_parent.get(entity_name, []))
            print(f'Written: {ent_path}', file=sys.stderr)

    else:
        fh = sys.stdout
        if global_option_sets:
            print('// ── Global Option Sets ────────────────────────────────────────────', file=fh)
            print('', file=fh)
            for os_data in global_option_sets.values():
                emit_option_set(fh, os_data['name'], os_data['display_name'],
                                os_data['description'], os_data['values'], is_global=True,
                                source_solution=os_data.get('source_solution'))

        for entity_name, entity in all_entities.items():
            emit_entity_file(fh, entity, pk_map,
                             color_map.get(entity_name),
                             rels_by_parent.get(entity_name, []))


if __name__ == '__main__':
    main()
