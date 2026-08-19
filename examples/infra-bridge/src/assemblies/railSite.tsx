/** @jsxImportSource brepjs-families */

import { assembly, type EngineeringSemantics } from 'brepjs-families';
import { z } from 'zod';
import { RailArchBridge } from './railArchBridge.js';

const railSiteProps = z.object({
  bridgeKey: z.string().trim().min(1),
  bridgeName: z.string().trim().min(1).default('Rail bridge'),
  siteName: z.string().trim().min(1),
});

export type RailSiteProps = z.output<typeof railSiteProps>;
export type RailSiteInput = z.input<typeof railSiteProps>;

function semantics({ siteName }: RailSiteProps): EngineeringSemantics {
  return { kind: 'site', properties: { name: siteName } };
}

/** Parameterized civil Site containing one keyed rail-arch Bridge occurrence. */
export const RailSite = assembly<RailSiteProps, RailSiteInput>(
  'RailSite',
  ({ bridgeKey, bridgeName }) => <RailArchBridge key={bridgeKey} name={bridgeName} />,
  { props: railSiteProps, semantics }
);
