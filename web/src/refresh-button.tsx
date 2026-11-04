import { RefreshCw } from 'lucide-react';
import { refreshLabel } from '../../shared/campaign-presentation.mjs';

export function RefreshButton({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  return <button className="button secondary" disabled={loading} onClick={onRefresh}><RefreshCw className={loading ? 'refresh-icon spinning' : 'refresh-icon'} size={15} />{refreshLabel(loading)}</button>;
}
