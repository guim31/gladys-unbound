// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
//   - read_statistics: read the server now, into a sentence a following
//     action can send or speak, and figures a condition can test;
//   - flush_cache: empty the cache (a name and below, or all of it), after a
//     DNS change at home. Refused unless "Allow flushing the cache" is on.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async read_statistics(hub) {
    return hub.statistics();
  },

  async flush_cache(hub, { fields = {} }) {
    return hub.flushCache(typeof fields.name === 'string' ? fields.name : '');
  },
};
