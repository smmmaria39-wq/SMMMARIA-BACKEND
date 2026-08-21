import { z } from 'zod';

const mediaSchema = z.object({
  type: z.enum(['image', 'video']),
  url: z.string().url().refine(url => url.startsWith('https://'), {
    message: 'Media URL must be HTTPS'
  })
}).nullable().optional();

export const sendMessageSchema = {
  body: z.object({
    message: z.string().trim().max(500).optional(),
    replyToId: z.string().optional().nullable(),
    media: mediaSchema
  }).refine(data => data.message || data.media, {
    message: 'Message or media is required'
  })
};

export const editMessageSchema = {
  body: z.object({
    message: z.string().trim().min(1).max(500)
  })
};
