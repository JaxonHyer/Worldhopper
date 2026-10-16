/**
 * Pure NPC registry helpers. The browser-facing loader supplies JSON imported
 * by Vite; Node tests can feed the same parsed JSON here without a browser.
 */

import { validateNpcDefinition } from './dialogue.js';

const EMPTY = Object.freeze([]);

export function createNpcRegistry(definitions) {
  if (!Array.isArray(definitions)) throw new Error('NPC definitions must be an array');

  const all = [...definitions];
  const byDialogueId = new Map();
  const byEntityId = new Map();
  const byMap = new Map();

  for (const definition of all) {
    validateNpcDefinition(definition);
    if (byDialogueId.has(definition.id)) throw new Error(`duplicate NPC dialogue id: ${definition.id}`);
    if (byEntityId.has(definition.entityId)) throw new Error(`duplicate NPC entity id: ${definition.entityId}`);
    deepFreeze(definition);
    byDialogueId.set(definition.id, definition);
    byEntityId.set(definition.entityId, definition);

    const group = byMap.get(definition.mapId) ?? [];
    group.push(definition);
    byMap.set(definition.mapId, group);
  }

  for (const [mapId, group] of byMap) byMap.set(mapId, Object.freeze(group));
  const frozenDefinitions = Object.freeze(all);

  function getNpcDefinition(dialogueId) {
    return byDialogueId.get(dialogueId) ?? null;
  }

  function getNpcDefinitionsForMap(mapId) {
    return byMap.get(mapId) ?? EMPTY;
  }

  /**
   * Spawn records for the Agent 1 world-state hook. Position Y is intentionally
   * absent: createWorldState derives it from the map's seeded terrain height.
   *
   * @param {string} mapId
   * @returns {Array<{id:string,kind:string,dialogueId:string,static:boolean,position:{x:number,z:number},rotationY:number}>}
   */
  function getNpcSpawnDefinitionsForMap(mapId) {
    return getNpcDefinitionsForMap(mapId).map((definition) =>
      Object.freeze({
        id: definition.entityId,
        kind: 'npc',
        dialogueId: definition.id,
        static: true,
        position: Object.freeze({ x: definition.spawn.x, z: definition.spawn.z }),
        rotationY: definition.spawn.rotationY,
      }),
    );
  }

  /**
   * Find the closest authored NPC whose actual world-state entity is in range.
   * The entity position, not a renderer object or the JSON spawn copy, is the
   * source of truth. Ties use the stable entity id rather than iteration order.
   */
  function findNearbyNpc(playerPosition, entities) {
    if (!isPosition(playerPosition) || !Array.isArray(entities)) return null;

    let nearest = null;
    for (const entity of entities) {
      if (entity?.kind !== 'npc' || typeof entity.id !== 'string') continue;
      const definition = byEntityId.get(entity.id);
      if (!definition || entity.dialogueId !== definition.id || !isPosition(entity.position)) continue;

      const dx = entity.position.x - playerPosition.x;
      const dz = entity.position.z - playerPosition.z;
      const distanceSquared = dx * dx + dz * dz;
      const rangeSquared = definition.interactionRadius * definition.interactionRadius;
      if (distanceSquared > rangeSquared) continue;
      if (
        nearest &&
        (distanceSquared > nearest.distanceSquared ||
          (distanceSquared === nearest.distanceSquared && entity.id >= nearest.entityId))
      ) {
        continue;
      }

      nearest = {
        entityId: entity.id,
        dialogueId: definition.id,
        name: definition.name,
        distance: Math.sqrt(distanceSquared),
        distanceSquared,
      };
    }

    return nearest ? Object.freeze(nearest) : null;
  }

  return Object.freeze({
    NPC_DEFINITIONS: frozenDefinitions,
    getNpcDefinition,
    getNpcDefinitionsForMap,
    getNpcSpawnDefinitionsForMap,
    findNearbyNpc,
  });
}

function isPosition(value) {
  return value !== null && Number.isFinite(value?.x) && Number.isFinite(value?.z);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
