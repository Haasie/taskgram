import { RadarModule } from '../../src/components/RadarView';
import type { ModuleViewProps } from '../types';

export default function Priveradar({ today }: ModuleViewProps) {
  return <RadarModule area="personal" today={today} />;
}
