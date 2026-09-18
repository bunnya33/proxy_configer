<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from './api';
import LoginView from './components/LoginView.vue';
import ManagerView from './components/ManagerView.vue';

const checking = ref(true);
const authenticated = ref(false);

async function checkSession() {
  try {
    await api('/api/auth/session');
    authenticated.value = true;
  } catch {
    authenticated.value = false;
  } finally {
    checking.value = false;
  }
}

function handleExpired() {
  authenticated.value = false;
}

onMounted(() => {
  window.addEventListener('auth-expired', handleExpired);
  void checkSession();
});
onBeforeUnmount(() => window.removeEventListener('auth-expired', handleExpired));
</script>

<template>
  <div v-if="checking" class="boot-screen">
    <div class="brand-mark">C</div>
    <span>正在加载配置中心</span>
  </div>
  <LoginView v-else-if="!authenticated" @success="authenticated = true" />
  <ManagerView v-else @logout="authenticated = false" />
</template>
