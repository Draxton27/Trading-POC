"""Predeclared comparison plan; this phase does not fit or score a new model."""
from ml.phase28.train import FEATURES
from ml.phase41d.registry import DEFINITIONS


F0 = tuple(FEATURES)
# Deliberately small. The original return_4 and relative_volume_20 already live in F0.
F1_ADDED = (
    'body_range_ratio', 'upper_wick_range_ratio', 'lower_wick_range_ratio',
    'close_location_in_range', 'consecutive_up_4', 'consecutive_down_4',
    'higher_highs_4', 'lower_lows_4',
)
F2_ADDED = (
    'sma_full_order_15m', 'sma_short_pair_alignment_15m',
    'sma_long_pair_alignment_15m', 'sma20_slope_15m', 'sma40_slope_15m',
    'sma100_slope_15m', 'sma200_slope_15m',
    'price_relative_sma20_15m', 'price_relative_sma40_15m',
    'price_relative_sma100_15m', 'price_relative_sma200_15m',
    'candidate_ceiling_context_15m', 'candidate_floor_context_15m',
    'alignment_1h', 'alignment_1d',
)


def comparison_protocol():
    return {
        'schema': 'phase41d-comparison-protocol-v1',
        'status': 'FROZEN_DEFINITIONS_NO_TRAINING',
        'research_population': 'NVDA IEX raw, historical 15m, Phase 38E original folds',
        'targets': [definition.target_id for definition in DEFINITIONS],
        'candidate_models': ['historical_prevalence', 'logistic_regression', 'XGBoost', 'LightGBM'],
        'features': {'F0': list(F0), 'F1': list((*F0, *F1_ADDED)),
                     'F2': list((*F0, *F1_ADDED, *F2_ADDED)),
                     'implementation_status': 'SPECIFICATION_ONLY',
                     'categorical_encoding': 'MUST_BE_FROZEN_BEFORE_TRAINING'},
        'scenario_policy': {'primary': 'delayed', 'separate_secondary': 'ideal',
                            'delayed_availability': 'bar close + 20 minutes, simulated, not verified receipt'},
        'split_policy': {
            'preserve_original_folds': True,
            'group': 'complete NYSE sessions',
            'train_only_if_target_known_before_test_cut': True,
            'purge_overlapping_labels': True,
            'early_stopping': 'only inner validation earlier than external test fold',
            'preprocessing': 'fit on causally eligible training rows only',
            'same_target_same_rows_for_all_models': True,
            'threshold_selection': 'inner development only; never outer fold',
            'no_future_features': True,
            'no_direct_SIP_split_IEX_raw_price_operations': True,
        },
        'metrics': {
            'binary': ['precision', 'recall', 'PR_AUC', 'ROC_AUC', 'Brier', 'log_loss',
                       'balanced_accuracy', 'positive_prevalence', 'confusion_matrix', 'calibration'],
            'three_class': ['macro_F1', 'per_class_precision', 'per_class_recall',
                            'balanced_accuracy', 'log_loss', 'Brier', 'calibration'],
            'PR_AUC_reference': 'positive prevalence of this target and identical evaluation rows',
            'uncertainty': 'paired resampling by NYSE session; inspect week/month grouping sensitivity',
            'cross_target_winner_rule': 'FORBIDDEN',
        },
        'evidence_labels': ['HISTORICAL_EXPLORED', 'TEMPORAL_VALIDATION', 'PROSPECTIVE_UNSEEN'],
        'historical_status': 'HISTORICAL_EXPLORED',
        'prospective_gate': {
            'protocol_frozen_at_utc': 'recorded by the generation manifest; no retroactive designation',
            'candidate_model_sha256': None,
            'feature_schema_sha256': None,
            'decision_rule_sha256': None,
            'minimum_evaluable_sessions': 60,
            'minimum_positive_events': 20,
            'minimum_negative_events': 20,
            'primary_statistics': ['PR_AUC_vs_prevalence_for_binary', 'Brier_vs_prevalence',
                                   'macro_F1_vs_baseline_for_original'],
            'unavailable_policy': 'exclude with reason; never impute outcome or timestamp',
            'incomplete_session_policy': 'exclude incomplete outcome; preserve observation and exclusion',
            'status_before_gate': 'INSUFFICIENT_EVIDENCE',
            'caveat': 'These counts are a minimum reporting gate, not a power calculation or validation guarantee.',
        },
        'technical_feature_hypotheses': {
            'candle_geometry': {
                'body_range_ratio': '|close-open|/(high-low)',
                'upper_wick_range_ratio': '(high-max(open,close))/(high-low)',
                'lower_wick_range_ratio': '(min(open,close)-low)/(high-low)',
                'close_location_in_range': '(close-low)/(high-low)',
                'zero_range': 'mark missing; never divide by zero or invent a value',
                'body_direction': 'sign(close-open)',
                'range_atr': '(high-low)/ATR14(t)',
                'volume_ratio': 'volume(t)/mean(volume of 20 prior complete bars)',
            },
            'candle_sequence': {
                'windows_bars': [2, 3, 4, 8],
                'rolling_directional_return': 'close(t)/close(t-k)-1, k fixed before training',
                'consecutive_up_4': 'count consecutive close(i)>open(i), backward from t, max 4',
                'consecutive_down_4': 'count consecutive close(i)<open(i), backward from t, max 4',
                'higher_highs_4': 'count adjacent high(i)>high(i-1) in last 4 complete bars',
                'lower_lows_4': 'count adjacent low(i)<low(i-1) in last 4 complete bars',
                'higher_lows_4': 'count adjacent low(i)>low(i-1) in last 4 complete bars',
                'lower_highs_4': 'count adjacent high(i)<high(i-1) in last 4 complete bars',
                'causality': 'all windows end at t and require continuous verified bars',
            },
            'investep_context': {
                'illustrated_orders': ['20>40>100>200', '40>20>100>200',
                                       '200>100>40>20', '200>100>20>40'],
                'inputs': ['sma_full_order', 'sma_short_pair_alignment', 'sma_long_pair_alignment',
                           'sma20_slope', 'sma40_slope', 'sma100_slope', 'sma200_slope',
                           'price_relative_to_each_sma', 'sma20_touch', 'sma40_touch',
                           'sma100_touch', 'sma200_touch', 'sma_rejection',
                           'sma_full_candle_break', 'sma_retest_status'],
                'candidate_ceiling_floor_requires': ['SMA_order', 'price_position',
                                                     'approach_direction', 'verified_geometry',
                                                     'timeframe', 'causal_confirmation'],
                'source_engine': 'Phase 41A investep-technical-context.ts; reuse its closed-bar semantics',
                'candidate_not_effective_without_confirmation': True,
                'multitimeframe': ['15m', '1h', '1d'],
                'diagram_status': 'didactic potential only; colors/icons/arrows are not empirical results',
            },
        },
    }
