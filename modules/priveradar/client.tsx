import { RadarModule } from '../../src/components/RadarView';
import type { ModuleViewProps } from '../types';

export default function Priveradar({ today, settings }: ModuleViewProps) {
  const tag = typeof settings.tag === 'string' ? settings.tag : undefined;
  const staleDays = typeof settings.staleDays === 'number' ? settings.staleDays : undefined;
  return <RadarModule area="personal" today={today} tag={tag} staleDays={staleDays} />;
}
