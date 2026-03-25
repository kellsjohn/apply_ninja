<template lang="pug">
div(v-if="toastMsg.msg", class="fixed top-12 right-4 md:right-1/2 md:transform md:translate-x-1/2 z-50")
  div(class="px-4 py-2 flex items-center gap-1 border-2 text-sm md:text-base bg-white dark:bg-neutral-950 rounded-lg shadow-2xl", :class="getClass(toastMsg.type)")
    TickIcon(v-if="toastMsg.type === toastTypes.SUCCESS", class="w-6 h-6")
    ErrorIcon(v-else-if="toastMsg.type === toastTypes.ERROR", class="w-6 h-6")
    div(class="mt-0.5 text-neutral-900 dark:text-neutral-100") {{ toastMsg.msg }}
</template>

<script setup>
import { computed } from 'vue';

import ErrorIcon from './icons/error.vue';
import TickIcon from './icons/tick.vue';

import { toastTypes } from '../constants.js';
import { mainStore } from '../stores/index.js';

const toastMsg = computed(() => {
  return mainStore().toastMsg;
});

function getClass(type) {
  if (type === toastTypes.SUCCESS) {
    return 'border-indigo-500 text-indigo-500';
  }
  if (type === toastTypes.ERROR) {
    return 'border-red-500 text-red-500';
  }
  return '';
}
</script>
