import { RadarModule } from '../../src/components/RadarView';
import type { ModuleViewProps } from '../types';

export default function Werkradar({ today }: ModuleViewProps) {
  return <RadarModule area="work" today={today} />;
}
