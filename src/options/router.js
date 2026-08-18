import { createRouter, createWebHashHistory } from 'vue-router';

import Overview from './pages/Overview.vue';

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      component: Overview,
      name: 'diagnostics',
      path: '/',
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
});
