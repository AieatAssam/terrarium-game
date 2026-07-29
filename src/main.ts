import { bootstrap } from './core/bootstrap';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Root element #app not found');
}

void bootstrap(root);
