"""Frozen target definitions. A changed formula requires a new target ID."""
import hashlib
import json
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class TargetDefinition:
    target_id: str
    target_version: int
    classes: tuple[str, ...]
    positive_class: str | None
    formula: str
    parameters: tuple[tuple[str, str], ...]


DEFINITIONS = (
    TargetDefinition('NET_MOVE_4B_ATR05_V1', 1, ('ALCISTA', 'BAJISTA', 'LATERAL'), None,
                     'change=close(bar4)-entry_open; ALCISTA iff change>0.5*ATR14(t); '
                     'BAJISTA iff change< -0.5*ATR14(t); otherwise LATERAL',
                     (('horizon_bars', '4'), ('atr_multiple', '0.5'), ('terminal_strict', 'true'))),
    TargetDefinition('DOWN_TOUCH_4B_ATR05_V1', 1, ('DOWN_TOUCH', 'NO_DOWN_TOUCH'), 'DOWN_TOUCH',
                     'DOWN_TOUCH iff min(low(bar1),...,low(bar4))<=entry_open-0.5*ATR14(t)',
                     (('horizon_bars', '4'), ('atr_multiple', '0.5'), ('touch_inclusive', 'true'))),
    TargetDefinition('PERSISTENT_BEAR_4B_ATR05_V1', 1,
                     ('PERSISTENT_BEAR', 'NOT_PERSISTENT_BEAR'), 'PERSISTENT_BEAR',
                     'PERSISTENT_BEAR iff original_label=BAJISTA and closes_below_entry>=3 '
                     'and max_consecutive_closes_below_entry>=3',
                     (('horizon_bars', '4'), ('atr_multiple', '0.5'), ('streak', '3'))),
)

# Fixed review digests. Do not update one while keeping its target ID/version.
EXPECTED_SHA256 = {
    'NET_MOVE_4B_ATR05_V1': '15ae301b5c8439dcc2f364f9b43648aa46282b19c83cce9e4a6242347333dd0e',
    'DOWN_TOUCH_4B_ATR05_V1': '7dacfaa2af4644c24820dd0bceebfc6525b1be2ef5017378d6344870968a5505',
    'PERSISTENT_BEAR_4B_ATR05_V1': 'ddb70c2589cad04ecd487e69b8289d25410b872718132cdf577aa6aa67b327ae',
}


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical_json(value).encode('utf8')).hexdigest()


def definition_payload(definition):
    return asdict(definition)


def validate_registry(definitions=DEFINITIONS, expected=EXPECTED_SHA256):
    if len(definitions) != 3 or len({d.target_id for d in definitions}) != 3:
        raise ValueError('Registro de objetivos incompleto o duplicado.')
    if set(expected) != {d.target_id for d in definitions}:
        raise ValueError('Identificadores de objetivos incompatibles.')
    for definition in definitions:
        if (definition.target_version != 1 or not definition.target_id.endswith('_V1') or
                digest(definition_payload(definition)) != expected[definition.target_id]):
            raise ValueError('Definición alterada: crear otro identificador y versión.')
    return {'schema': 'phase41d-target-registry-v1',
            'definitions': [{**definition_payload(d), 'definition_sha256': expected[d.target_id]}
                            for d in definitions]}
