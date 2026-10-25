"""Versioned, non-ordinal schema appended to the frozen Phase 41D column order."""
from itertools import permutations

from ml.phase41d.protocol import F0, F1_ADDED, F2_ADDED
from ml.phase41d.registry import digest

FULL_ORDERS = tuple('>'.join(map(str, order)) for order in permutations((20, 40, 100, 200)))
PAIR = ('BULLISH_ALIGNMENT', 'BEARISH_ALIGNMENT', 'MIXED', 'INSUFFICIENT_DATA')
SLOPE = ('RISING', 'FALLING', 'FLAT', 'UNAVAILABLE')
ALIGNMENT = ('ALIGNED_BULLISH', 'ALIGNED_BEARISH', 'SHORT_TERM_PULLBACK',
             'SHORT_TERM_RECOVERY', 'CONFLICTING', 'MIXED', 'INSUFFICIENT_DATA')
CONTEXT = ('UNAVAILABLE', 'NO_CANDIDATE', 'POTENTIAL_NO_INTERACTION',
           'INTERACTION_OBSERVED', 'REJECTION_OBSERVED', 'BREAK_OBSERVED',
           'RETEST_PENDING', 'RETEST_CONFIRMED', 'RETEST_EXPIRED', 'RECOVERY_OBSERVED')
NUMERIC = (*F0, *F1_ADDED, *F2_ADDED[7:11])
CATEGORIES = {
    'sma_full_order_15m': (*FULL_ORDERS, 'TIED', 'UNAVAILABLE'),
    'sma_short_pair_alignment_15m': PAIR,
    'sma_long_pair_alignment_15m': PAIR,
    **{name: SLOPE for name in F2_ADDED[3:7]},
    'candidate_ceiling_context_15m': CONTEXT,
    'candidate_floor_context_15m': CONTEXT,
    'alignment_1h': PAIR,
    'alignment_1d': PAIR,
}


def feature_schema():
    columns = {'F0': list(F0), 'F1': list((*F0, *F1_ADDED)),
               'F2': list((*F0, *F1_ADDED, *F2_ADDED))}
    if (len(columns['F0']), len(columns['F1']), len(columns['F2'])) != (10, 18, 33):
        raise ValueError('Definición de columnas 41D alterada.')
    return {
        'schema': 'phase41e-feature-schema-v1', 'columns': columns,
        'types': {name: 'finite_number_or_null' for name in NUMERIC} |
                 {name: 'category' for name in CATEGORIES},
        'categories': {name: list(values) for name, values in CATEGORIES.items()},
        'missing_policy': {'numeric': 'null, never zero-filled',
                           'categorical': 'explicit unavailable state; never mapped to bearish',
                           'complete_F2': 'all numeric non-null and categorical available'},
        'model_policy': {'linear': 'one-hot fit only on causally eligible training rows',
                         'trees': 'categorical features or train-only one-hot; no arbitrary ordinal codes',
                         'training_in_this_phase': False},
        'semantics': {'SIP_delay_minutes': [15, 20, 30],
                      'price_relative': 'sipClose / sipSma - 1; never IEX / SIP',
                      'sma_order': 'strict descending prices, or TIED, or UNAVAILABLE',
                      'sequence_window': 'four continuous closed bars, three adjacent comparisons',
                      'retrospective_adjustment': 'SIP split may contain later corporate-action adjustments'},
    }


def schema_sha256():
    return digest(feature_schema())


def validate_features(values):
    import math
    if list(values) != feature_schema()['columns']['F2']:
        raise ValueError('Orden de columnas F2 inválido.')
    for name, value in values.items():
        if name in CATEGORIES:
            if value not in CATEGORIES[name]:
                raise ValueError(f'Categoría incompatible: {name}.')
        elif value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))
                                    or not math.isfinite(value)):
            raise ValueError(f'Variable numérica incompatible: {name}.')
    return True
