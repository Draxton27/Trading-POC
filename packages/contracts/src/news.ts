import {z} from 'zod';

export const NewsCategory=z.enum(['RESULTADOS','PRODUCTO','REGULACION','MACROECONOMIA','SEMICONDUCTORES','OTROS']);
export const NewsSentiment=z.enum(['POSITIVO','NEGATIVO','NEUTRAL','INCIERTO']);
export const NewsRelevance=z.enum(['BAJA','MEDIA','ALTA']);
export const NewsClassification=z.object({
  assets:z.array(z.enum(['NVDA','QQQ','SMH'])).max(3),
  category:NewsCategory,
  sentiment:NewsSentiment,
  relevance:NewsRelevance,
  justification:z.string().trim().min(1).max(240),
  evidence:z.string().trim().min(1).max(240),
  insufficientEvidence:z.boolean(),
}).strict();
export type NewsClassification=z.infer<typeof NewsClassification>;
