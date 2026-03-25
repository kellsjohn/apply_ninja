import { ref } from 'vue';

// import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';

const DELAY_TO_CLEAR_TOAST_MSG = 3000;

export const mainStore = defineStore('mainStore', () => {
  const toastMsg = ref({});
  //   const isDarkMode = ref(useLocalStorage('isDarkMode', false));

  const toastTimeOutId = ref(undefined);

  function toast(msg, type) {
    toastMsg.value = { msg, type };
    clearTimeout(toastTimeOutId.value);
    toastTimeOutId.value = setTimeout(() => {
      toastMsg.value = {};
    }, DELAY_TO_CLEAR_TOAST_MSG);
  }

  return {
    toastMsg,
    // isDarkMode,
    toast,
  };
});
