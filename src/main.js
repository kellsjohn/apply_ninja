import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import './assets/tailwind.css';

import { createPinia } from 'pinia';
// import { createGtag } from 'vue-gtag';

const app = createApp(App);

// app.use(
//   createGtag({
//     tagId: import.meta.env.VITE_GA_MEASUREMENT_ID,
//   }),
// );
app.use(router);
app.use(createPinia());
app.mount('#app');
