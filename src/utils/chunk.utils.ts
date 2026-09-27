export const FCM_MULTICAST_LIMIT = 500;

export const normalizeTokens = (tokens: string[]) => [...new Set(tokens.map((token) => token.trim()))];

export const chunkTokens = (tokens: string[], size: number) => {
  if (!Number.isInteger(size) || size < 1 || size > FCM_MULTICAST_LIMIT) {
    throw new Error(`Chunk size must be between 1 and ${FCM_MULTICAST_LIMIT}`);
  }
  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += size) chunks.push(tokens.slice(i, i + size));
  return chunks;
};
