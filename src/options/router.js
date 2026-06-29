import { createRouter, createWebHashHistory } from 'vue-router';

import Logs from './pages/Logs.vue';
import Overview from './pages/Overview.vue';
import Profiles from './pages/Profiles.vue';
import Settings from './pages/Settings.vue';

const routes = [
  {
    component: Settings,
    name: 'settings',
    path: '/settings',
  },
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
  {
    path: '/global',
    redirect: '/settings',
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
