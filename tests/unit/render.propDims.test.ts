import { describe, expect, it } from 'vitest';
import { GARDEN_SLIDE_TILE, NURSERY_TILE } from '../../src/sim/layout';
import { getNurseryPorts, getSlidePorts } from '../../src/sim/ports';
import { NURSERY_BODY, AUTOMATION_BODY, portWorldPosition } from '../../src/render/propDims';

describe('transit prop anchors', () => {
  it('puts opposite adjacent ports at one shared world point', () => {
    const nursery = portWorldPosition(getNurseryPorts().outboundDock, NURSERY_BODY);
    const slide = portWorldPosition(getSlidePorts({ id: 'slide-1', tile: GARDEN_SLIDE_TILE }).entryPort, AUTOMATION_BODY);

    expect(nursery).toEqual({ x: 8, y: 0, z: 7.5 });
    expect(slide).toEqual(nursery);
    expect(NURSERY_TILE).toEqual({ x: 8, z: 8 });
  });
});
