import { describe, expect, it } from 'vitest';
import { HABITAT_TILES, GARDEN_SLIDE_TILE, NURSERY_TILE } from '../../src/sim/layout';
import {
  getColourGatePorts,
  getConveyorPorts,
  getHabitatPorts,
  getNurseryPorts,
  getSlidePorts,
  hasTransitTileClearance,
  PORT_KIND_COMPATIBILITY,
  portsCompatible,
  portsJoined,
  TRANSIT_PORT_KINDS,
} from '../../src/sim/ports';

describe('Garden Transit ports', () => {
  it('declares every port kind pair in the compatibility matrix', () => {
    for (const from of TRANSIT_PORT_KINDS) {
      for (const to of TRANSIT_PORT_KINDS) {
        expect(PORT_KIND_COMPATIBILITY[from][to]).toEqual(expect.any(Boolean));
      }
    }
  });

  it('declares the shared Nursery → Slide → Gate → habitat port sets', () => {
    const nursery = getNurseryPorts().outboundDock;
    const slide = getSlidePorts({ id: 'slide-1', tile: GARDEN_SLIDE_TILE });
    const gate = getColourGatePorts();
    const ember = getHabitatPorts('emberNook-1', 'emberNook');

    expect(nursery.tile).toEqual(NURSERY_TILE);
    expect(slide.entryPort.tile).toEqual(GARDEN_SLIDE_TILE);
    expect(gate.lanePorts.west.kind).toBe('lane');
    expect(ember.approachDock.tile).toEqual(HABITAT_TILES.emberNook);
    expect(portsJoined(nursery, slide.entryPort)).toBe(true);
    expect(portsJoined(slide.exitPort, gate.inboundPort)).toBe(true);
    expect(portsCompatible(gate.lanePorts.west, ember.approachDock)).toBe(true);
    expect(portsJoined(gate.lanePorts.west, ember.approachDock)).toBe(false);
    const westConveyorEntry = getConveyorPorts({ id: 'conveyor-1', tile: { x: 7, z: 6 } }).entryPort;
    expect(portsCompatible(gate.lanePorts.west, { ...westConveyorEntry, facing: 'east' })).toBe(true);
  });

  it('keeps artifact tiles clear and rejects same-owner or same-facing joins', () => {
    const slide = getSlidePorts({ id: 'slide-1', tile: GARDEN_SLIDE_TILE });
    const sameOwner = getSlidePorts({ id: 'slide-1', tile: { x: 8, z: 6 } });
    const sameFacing = getSlidePorts({ id: 'slide-2', tile: { x: 8, z: 6 } });

    expect(hasTransitTileClearance(GARDEN_SLIDE_TILE, [NURSERY_TILE])).toBe(true);
    expect(hasTransitTileClearance(GARDEN_SLIDE_TILE, [GARDEN_SLIDE_TILE])).toBe(false);
    expect(portsCompatible(slide.entryPort, sameOwner.exitPort)).toBe(false);
    expect(portsJoined(slide.exitPort, sameFacing.exitPort)).toBe(false);
  });
});
