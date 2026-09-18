<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Lock, User } from '@element-plus/icons-vue';
import { api } from '../api';

const emit = defineEmits<{ success: [] }>();
const formRef = ref<FormInstance>();
const loading = ref(false);
const form = reactive({ username: '', password: '' });
const rules: FormRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
};

async function submit() {
  if (!(await formRef.value?.validate().catch(() => false))) return;
  loading.value = true;
  try {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify(form) });
    emit('success');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-panel">
      <div class="login-brand">
        <div class="brand-mark">C</div>
        <div>
          <h1>Clash 配置中心</h1>
          <p>订阅与策略管理</p>
        </div>
      </div>
      <div class="login-heading">
        <h2>后台登录</h2>
        <p>登录后管理代理节点、分流规则与订阅地址。</p>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @keyup.enter="submit">
        <el-form-item label="账号" prop="username">
          <el-input v-model="form.username" size="large" autocomplete="username" placeholder="请输入管理账号">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            size="large"
            type="password"
            show-password
            autocomplete="current-password"
            placeholder="请输入登录密码"
          >
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-button class="login-submit" type="primary" size="large" :loading="loading" @click="submit">登录</el-button>
      </el-form>
    </section>
    <aside class="login-context">
      <div class="status-pill"><span></span> 配置服务运行中</div>
      <div class="context-copy">
        <p class="eyebrow">CONFIG OPERATIONS</p>
        <h2>一处维护，多端订阅</h2>
        <p>每个路由对应一份独立 Clash 配置，保存后订阅地址即时生效。</p>
      </div>
      <div class="route-preview">
        <code>/subscribe/singapore</code>
        <code>/subscribe/mainland</code>
      </div>
    </aside>
  </main>
</template>
