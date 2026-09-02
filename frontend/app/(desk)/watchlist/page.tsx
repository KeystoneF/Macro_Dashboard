import Placeholder from '../Placeholder';
import { bySlug } from '../modules';

export default function Page() {
  return <Placeholder module={bySlug('watchlist')!} />;
}
