/**
 * fomo serves every profile picture twice: a ~6 KB `_small` thumbnail and the
 * full-size original at the same key without that suffix. The leaderboard
 * payload hands out the thumbnail, which is fine at 24 px and visibly soft
 * once it is stretched across an 88 px avatar or a full-width banner.
 *
 * The signing query string covers the whole bucket, so it carries over.
 */
export function fullSize(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/_small(\.[a-z]+)(\?|$)/i, "$1$2");
}
