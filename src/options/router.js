import { createRouter, createWebHashHistory } from 'vue-router';

import Logs from './pages/Logs.vue';
import Overview from './pages/Overview.vue';
import Profiles from './pages/Profiles.vue';

const routes = [
  {
    component: Overview,
    name: 'overview',
    path: '/',
  },
  {
    component: Profiles,
    name: 'profiles',
    path: '/profiles',
  },
  {
    component: Logs,
    name: 'logs',
    path: '/logs',
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
