/**
 * Static NPC content registry. JSON imports are bundled by Vite; there is no
 * runtime fetch and no external request. A map asks for only its own records.
 */

import rosharSurveyor from './npcs/roshar-surveyor.json';
import { createNpcRegistry } from './npc-registry.js';

const registry = createNpcRegistry([rosharSurveyor]);

export const NPC_DEFINITIONS = registry.NPC_DEFINITIONS;
export const getNpcDefinition = registry.getNpcDefinition;
export const getNpcDefinitionsForMap = registry.getNpcDefinitionsForMap;
export const getNpcSpawnDefinitionsForMap = registry.getNpcSpawnDefinitionsForMap;
export const findNearbyNpc = registry.findNearbyNpc;
