<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Check,
  CopyDocument,
  Delete,
  Document,
  Edit,
  Link,
  Plus,
  Refresh,
  Search,
  Setting,
  SwitchButton
} from '@element-plus/icons-vue';
import { api } from '../api';
import type { ConfigContent, ConfigRecord, RuleRecord } from '../types';

const emit = defineEmits<{ logout: [] }>();

const configs = ref<ConfigRecord[]>([]);
const currentId = ref('');
const content = ref<ConfigContent>({ proxies: [], rules: [], proxyGroups: [], policyOptions: [] });
const initialLoading = ref(true);
const contentLoading = ref(false);
const activeTab = ref('proxies');
const sidebarQuery = ref('');
const proxyQuery = ref('');
const ruleQuery = ref('');
const rulesTableHost = ref<HTMLElement>();
const ruleTableHeight = ref(320);
const rawYaml = ref('');
const rawLoading = ref(false);
const rawSaving = ref(false);
const hasUnsavedChanges = ref(false);
const savingChanges = ref(false);

const configDialog = reactive({ visible: false, editing: false, saving: false });
const configForm = reactive({ id: '', name: '', description: '' });
const proxyDialog = reactive({ visible: false, index: -1, saving: false });
const proxyForm = reactive({
  name: '',
  type: 'vmess',
  server: '',
  port: 443 as number | undefined,
  uuid: '',
  password: '',
  cipher: '',
  alterId: 0 as number | undefined,
  network: 'ws',
  tls: true,
  skipCertVerify: false,
  wsPath: '',
  wsHost: '',
  extra: '{}'
});
const ruleDialog = reactive({ visible: false, saving: false });
const ruleForm = reactive({ type: 'DOMAIN-SUFFIX', payload: '', policy: 'DIRECT', options: '' });
type RuleField = 'type' | 'payload' | 'policy' | 'options';
type FocusableEditor = { focus?: () => void };
const ruleEditorRef = ref<FocusableEditor | FocusableEditor[]>();
const editingRule = reactive({ index: -1, field: '' as RuleField | '', value: '', saving: false });

const currentConfig = computed(() => configs.value.find((item) => item.id === currentId.value));
const filteredConfigs = computed(() => {
  const query = sidebarQuery.value.trim().toLowerCase();
  return query
    ? configs.value.filter((item) => `${item.name} ${item.id} ${item.description}`.toLowerCase().includes(query))
    : configs.value;
});
const filteredProxies = computed(() => {
  const query = proxyQuery.value.trim().toLowerCase();
  return content.value.proxies
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !query || JSON.stringify(item).toLowerCase().includes(query));
});
const filteredRules = computed(() => {
  const query = ruleQuery.value.trim().toLowerCase();
  return content.value.rules
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !query || item.raw.toLowerCase().includes(query));
});
const ruleColumns = [
  { key: 'number', dataKey: 'index', title: '#', width: 54 },
  { key: 'type', dataKey: 'item.type', title: '类型', width: 160 },
  { key: 'payload', dataKey: 'item.payload', title: '匹配内容', width: 320, minWidth: 260, flexGrow: 2 },
  { key: 'policy', dataKey: 'item.policy', title: '策略', width: 170 },
  { key: 'options', dataKey: 'item.options', title: '附加参数', width: 150, minWidth: 120, flexGrow: 1 },
  { key: 'actions', dataKey: 'actions', title: '操作', width: 58, fixed: 'right', align: 'center' }
];
const subscriptionUrl = computed(() =>
  currentConfig.value?.subscribeUrl ? `${window.location.origin}${currentConfig.value.subscribeUrl}` : ''
);

function errorMessage(error: unknown) {
  ElMessage.error(error instanceof Error ? error.message : '操作失败');
}

async function loadConfigs(preferredId?: string) {
  configs.value = await api<ConfigRecord[]>('/api/configs');
  const target = preferredId || currentId.value;
  currentId.value = configs.value.some((item) => item.id === target)
    ? target
    : (configs.value.find((item) => !item.isTemplate)?.id ?? configs.value[0]?.id ?? '');
}

async function loadContent() {
  if (!currentId.value) return;
  contentLoading.value = true;
  try {
    content.value = await api<ConfigContent>(`/api/configs/${currentId.value}/content`);
    hasUnsavedChanges.value = false;
    if (activeTab.value === 'raw') await loadRaw();
    if (activeTab.value === 'rules') updateRulesTableHeight();
  } catch (error) {
    errorMessage(error);
  } finally {
    contentLoading.value = false;
  }
}

async function confirmDiscardChanges() {
  if (!hasUnsavedChanges.value) return true;
  try {
    await ElMessageBox.confirm('当前有尚未保存的代理或规则修改，确定放弃这些修改吗？', '未保存的修改', {
      confirmButtonText: '放弃修改',
      cancelButtonText: '继续编辑',
      type: 'warning'
    });
    return true;
  } catch {
    return false;
  }
}

async function selectConfig(id: string) {
  if (id === currentId.value) return;
  if (!(await confirmDiscardChanges())) return;
  currentId.value = id;
  rawYaml.value = '';
  await loadContent();
}

async function refreshContent() {
  if (!(await confirmDiscardChanges())) return;
  await loadContent();
}

function openCreateConfig() {
  Object.assign(configForm, { id: '', name: '', description: '' });
  Object.assign(configDialog, { visible: true, editing: false });
}

function openEditConfig() {
  if (!currentConfig.value) return;
  Object.assign(configForm, {
    id: currentConfig.value.id,
    name: currentConfig.value.name,
    description: currentConfig.value.description
  });
  Object.assign(configDialog, { visible: true, editing: true });
}

async function saveConfig() {
  if (!configForm.name.trim() || (!configDialog.editing && !configForm.id.trim())) {
    ElMessage.warning('请填写配置名称和路由标识');
    return;
  }
  configDialog.saving = true;
  try {
    if (configDialog.editing) {
      await api(`/api/configs/${configForm.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: configForm.name, description: configForm.description })
      });
      await loadConfigs(configForm.id);
      ElMessage.success('配置资料已更新');
    } else {
      const created = await api<ConfigRecord>('/api/configs', {
        method: 'POST',
        body: JSON.stringify(configForm)
      });
      await loadConfigs(created.id);
      await loadContent();
      ElMessage.success('已从默认模板新建配置');
    }
    configDialog.visible = false;
  } catch (error) {
    errorMessage(error);
  } finally {
    configDialog.saving = false;
  }
}

async function deleteConfig() {
  const config = currentConfig.value;
  if (!config || config.isTemplate) return;
  try {
    await ElMessageBox.confirm(`将永久删除“${config.name}”及其 YAML 文件。`, '删除配置', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning'
    });
    await api(`/api/configs/${config.id}`, { method: 'DELETE' });
    currentId.value = '';
    await loadConfigs();
    await loadContent();
    ElMessage.success('配置已删除');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') errorMessage(error);
  }
}

async function copySubscription() {
  if (!subscriptionUrl.value) return;
  try {
    await navigator.clipboard.writeText(subscriptionUrl.value);
    ElMessage.success('订阅地址已复制');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = subscriptionUrl.value;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    ElMessage.success('订阅地址已复制');
  }
}

function resetProxyForm() {
  Object.assign(proxyForm, {
    name: '',
    type: 'vmess',
    server: '',
    port: 443,
    uuid: '',
    password: '',
    cipher: '',
    alterId: 0,
    network: 'ws',
    tls: true,
    skipCertVerify: false,
    wsPath: '',
    wsHost: '',
    extra: '{}'
  });
}

function openCreateProxy() {
  resetProxyForm();
  Object.assign(proxyDialog, { visible: true, index: -1 });
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function openEditProxy(index: number) {
  const source = clonePlain(content.value.proxies[index]);
  const wsOpts = (source['ws-opts'] ?? {}) as Record<string, unknown>;
  const headers = (wsOpts.headers ?? {}) as Record<string, unknown>;
  const extra = clonePlain(source);
  const known = ['name', 'type', 'server', 'port', 'uuid', 'password', 'cipher', 'alterId', 'tls', 'skip-cert-verify', 'network'];
  known.forEach((key) => delete extra[key]);
  delete extra['ws-opts'];
  const remainingWs = clonePlain(wsOpts);
  delete remainingWs.path;
  if (remainingWs.headers && typeof remainingWs.headers === 'object') {
    const remainingHeaders = clonePlain(remainingWs.headers as Record<string, unknown>);
    delete remainingHeaders.Host;
    if (Object.keys(remainingHeaders).length) remainingWs.headers = remainingHeaders;
    else delete remainingWs.headers;
  }
  if (Object.keys(remainingWs).length) extra['ws-opts'] = remainingWs;
  Object.assign(proxyForm, {
    name: String(source.name ?? ''),
    type: String(source.type ?? ''),
    server: String(source.server ?? ''),
    port: source.port ? Number(source.port) : undefined,
    uuid: String(source.uuid ?? ''),
    password: String(source.password ?? ''),
    cipher: String(source.cipher ?? ''),
    alterId: source.alterId === undefined ? undefined : Number(source.alterId),
    network: String(source.network ?? ''),
    tls: Boolean(source.tls),
    skipCertVerify: Boolean(source['skip-cert-verify']),
    wsPath: String(wsOpts.path ?? ''),
    wsHost: String(headers.Host ?? ''),
    extra: JSON.stringify(extra, null, 2)
  });
  Object.assign(proxyDialog, { visible: true, index });
}

function buildProxy(): Record<string, unknown> {
  let proxy: Record<string, unknown>;
  try {
    proxy = JSON.parse(proxyForm.extra || '{}') as Record<string, unknown>;
  } catch {
    throw new Error('高级配置不是有效的 JSON');
  }
  if (!proxy || typeof proxy !== 'object' || Array.isArray(proxy)) throw new Error('高级配置必须是 JSON 对象');
  Object.assign(proxy, {
    name: proxyForm.name.trim(),
    type: proxyForm.type,
    server: proxyForm.server.trim(),
    port: proxyForm.port
  });
  const optional: Array<[string, string | number | undefined]> = [
    ['uuid', proxyForm.uuid.trim()],
    ['password', proxyForm.password.trim()],
    ['cipher', proxyForm.cipher.trim()],
    ['alterId', proxyForm.alterId],
    ['network', proxyForm.network]
  ];
  optional.forEach(([key, value]) => {
    if (value !== '' && value !== undefined) proxy[key] = value;
    else delete proxy[key];
  });
  proxy.tls = proxyForm.tls;
  proxy['skip-cert-verify'] = proxyForm.skipCertVerify;
  if (proxyForm.network === 'ws') {
    const ws = (proxy['ws-opts'] && typeof proxy['ws-opts'] === 'object' ? proxy['ws-opts'] : {}) as Record<string, unknown>;
    if (proxyForm.wsPath) ws.path = proxyForm.wsPath;
    const headers = (ws.headers && typeof ws.headers === 'object' ? ws.headers : {}) as Record<string, unknown>;
    if (proxyForm.wsHost) headers.Host = proxyForm.wsHost;
    if (Object.keys(headers).length) ws.headers = headers;
    if (Object.keys(ws).length) proxy['ws-opts'] = ws;
  } else {
    delete proxy['ws-opts'];
  }
  return proxy;
}

function saveProxy() {
  if (!proxyForm.name.trim() || !proxyForm.type || !proxyForm.server.trim() || !proxyForm.port) {
    ElMessage.warning('请填写名称、类型、服务器和端口');
    return;
  }
  proxyDialog.saving = true;
  try {
    const proxy = buildProxy();
    if (content.value.proxies.some((item, index) => index !== proxyDialog.index && item.name === proxy.name)) {
      throw new Error('代理名称已存在');
    }
    if (proxyDialog.index < 0) {
      content.value.proxies.push(proxy);
    } else {
      const previousName = content.value.proxies[proxyDialog.index]?.name;
      content.value.proxies.splice(proxyDialog.index, 1, proxy);
      if (typeof previousName === 'string' && previousName !== proxy.name) {
        content.value.proxyGroups.forEach((group) => {
          if (Array.isArray(group.proxies)) {
            group.proxies = group.proxies.map((name) => (name === previousName ? proxy.name : name));
          }
        });
      }
    }
    hasUnsavedChanges.value = true;
    proxyDialog.visible = false;
    ElMessage.success(proxyDialog.index < 0 ? '代理已加入待保存修改' : '代理修改已暂存');
  } catch (error) {
    errorMessage(error);
  } finally {
    proxyDialog.saving = false;
  }
}

async function deleteProxy(index: number, name: unknown) {
  try {
    await ElMessageBox.confirm(`删除代理“${String(name)}”？代理组中的同名引用也会移除。`, '删除代理', {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消'
    });
    content.value.proxies.splice(index, 1);
    content.value.proxyGroups.forEach((group) => {
      if (Array.isArray(group.proxies)) group.proxies = group.proxies.filter((item) => item !== name);
    });
    hasUnsavedChanges.value = true;
    ElMessage.success('代理删除已暂存');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') errorMessage(error);
  }
}

function openCreateRule() {
  Object.assign(ruleForm, { type: 'DOMAIN-SUFFIX', payload: '', policy: content.value.policyOptions[0] ?? 'DIRECT', options: '' });
  ruleDialog.visible = true;
}

function createRuleRecord(input: { type: string; payload: string; policy: string; options: string }): RuleRecord {
  const type = input.type.trim().toUpperCase();
  const payload = input.payload.trim();
  const policy = input.policy.trim();
  const options = input.options.split(',').map((item) => item.trim()).filter(Boolean);
  const raw = ['MATCH', 'FINAL'].includes(type)
    ? [type, policy, ...options].join(',')
    : [type, payload, policy, ...options].join(',');
  return { raw, type, payload: ['MATCH', 'FINAL'].includes(type) ? '' : payload, policy, options };
}

function saveRule() {
  if (!ruleForm.type || !ruleForm.policy || (!['MATCH', 'FINAL'].includes(ruleForm.type.toUpperCase()) && !ruleForm.payload.trim())) {
    ElMessage.warning('请完整填写规则');
    return;
  }
  ruleDialog.saving = true;
  try {
    content.value.rules.push(createRuleRecord(ruleForm));
    hasUnsavedChanges.value = true;
    ruleDialog.visible = false;
    ElMessage.success('规则已加入待保存修改');
  } catch (error) {
    errorMessage(error);
  } finally {
    ruleDialog.saving = false;
  }
}

async function deleteRule(index: number) {
  content.value.rules.splice(index, 1);
  hasUnsavedChanges.value = true;
  ElMessage.success('规则删除已暂存');
}

function isEditingRule(index: number, field: RuleField) {
  return editingRule.index === index && editingRule.field === field;
}

function startRuleEdit(index: number, field: RuleField) {
  if (editingRule.saving) return;
  const rule = content.value.rules[index];
  if (!rule || (field === 'payload' && ['MATCH', 'FINAL'].includes(rule.type))) return;
  editingRule.index = index;
  editingRule.field = field;
  editingRule.value = field === 'options' ? rule.options.join(',') : rule[field];
  void nextTick(() => {
    const editor = Array.isArray(ruleEditorRef.value) ? ruleEditorRef.value.at(-1) : ruleEditorRef.value;
    editor?.focus?.();
  });
}

function cancelRuleEdit() {
  if (editingRule.saving) return;
  editingRule.index = -1;
  editingRule.field = '';
  editingRule.value = '';
}

function blurRuleEditor(event: KeyboardEvent) {
  (event.target as HTMLElement | null)?.blur();
}

function commitRuleEdit() {
  if (editingRule.saving || editingRule.index < 0 || !editingRule.field) return;
  const index = editingRule.index;
  const field = editingRule.field;
  const value = editingRule.value.trim();
  const original = content.value.rules[index];
  if (!original) return cancelRuleEdit();

  const update = {
    type: original.type,
    payload: original.payload,
    policy: original.policy,
    options: original.options.join(',')
  };
  update[field] = value;
  if (!update.type || !update.policy || (!['MATCH', 'FINAL'].includes(update.type.toUpperCase()) && !update.payload)) {
    ElMessage.warning('规则类型、匹配内容和策略不能为空');
    return cancelRuleEdit();
  }
  const originalValue = field === 'options' ? original.options.join(',') : original[field];
  if (value === originalValue) return cancelRuleEdit();

  editingRule.saving = true;
  try {
    content.value.rules.splice(index, 1, createRuleRecord(update));
    hasUnsavedChanges.value = true;
  } catch (error) {
    errorMessage(error);
  } finally {
    editingRule.saving = false;
    cancelRuleEdit();
  }
}

function updateRulesTableHeight() {
  void nextTick(() => {
    const top = rulesTableHost.value?.getBoundingClientRect().top;
    if (top === undefined) return;
    ruleTableHeight.value = Math.max(180, Math.floor(window.innerHeight - top - 24));
  });
}

async function saveAllChanges() {
  if (!hasUnsavedChanges.value || savingChanges.value) return;
  savingChanges.value = true;
  try {
    content.value = await api<ConfigContent>(`/api/configs/${currentId.value}/content`, {
      method: 'PUT',
      body: JSON.stringify({
        proxies: content.value.proxies,
        proxyGroups: content.value.proxyGroups,
        rules: content.value.rules.map(({ type, payload, policy, options }) => ({ type, payload, policy, options }))
      })
    });
    hasUnsavedChanges.value = false;
    rawYaml.value = '';
    ElMessage.success('所有修改已保存');
  } catch (error) {
    errorMessage(error);
  } finally {
    savingChanges.value = false;
  }
}

async function loadRaw() {
  if (!currentId.value) return;
  rawLoading.value = true;
  try {
    rawYaml.value = await api<string>(`/api/configs/${currentId.value}/raw`);
  } catch (error) {
    errorMessage(error);
  } finally {
    rawLoading.value = false;
  }
}

async function saveRaw() {
  rawSaving.value = true;
  try {
    await api(`/api/configs/${currentId.value}/raw`, {
      method: 'PUT',
      body: JSON.stringify({ yaml: rawYaml.value })
    });
    await loadContent();
    await nextTick();
    activeTab.value = 'raw';
    ElMessage.success('YAML 已校验并保存');
  } catch (error) {
    errorMessage(error);
  } finally {
    rawSaving.value = false;
  }
}

async function handleTabChange(name: string | number) {
  if (name === 'raw') await loadRaw();
  if (name === 'rules') updateRulesTableHeight();
}

async function logout() {
  if (!(await confirmDiscardChanges())) return;
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    emit('logout');
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return;
  event.preventDefault();
  event.returnValue = '';
}

onMounted(async () => {
  window.addEventListener('resize', updateRulesTableHeight);
  window.addEventListener('beforeunload', handleBeforeUnload);
  try {
    await loadConfigs('singapore');
    await loadContent();
  } catch (error) {
    errorMessage(error);
  } finally {
    initialLoading.value = false;
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateRulesTableHeight);
  window.removeEventListener('beforeunload', handleBeforeUnload);
});
</script>

<template>
  <div class="manager-shell" v-loading.fullscreen.lock="initialLoading">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-mark small">C</div>
        <div><strong>Clash 配置中心</strong><span>订阅管理后台</span></div>
      </div>
      <nav class="config-nav">
        <button
          v-for="item in filteredConfigs"
          :key="item.id"
          type="button"
          class="config-nav-item"
          :class="{ active: item.id === currentId }"
          @click="selectConfig(item.id)"
        >
          <span class="config-icon"><Document /></span>
          <span class="config-copy">
            <span class="config-name">{{ item.name }}</span>
            <span class="config-route">{{ item.isTemplate ? '配置模板' : `/subscribe/${item.id}` }}</span>
          </span>
          <span v-if="item.isTemplate" class="template-dot" title="默认模板"></span>
        </button>
        <p v-if="!filteredConfigs.length" class="empty-nav">没有匹配的配置</p>
      </nav>
      <button type="button" class="create-config-button" @click="openCreateConfig">
        <Plus /> 新建配置
      </button>
      <div class="sidebar-footer">
        <span><i></i> 服务正常</span>
        <el-tooltip content="退出登录" placement="top">
          <button type="button" class="icon-plain" aria-label="退出登录" @click="logout"><SwitchButton /></button>
        </el-tooltip>
      </div>
    </aside>

    <main class="workspace">
      <div class="topbar">
        <el-input v-model="sidebarQuery" clearable placeholder="搜索配置..." class="topbar-search">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <nav class="topbar-nav" aria-label="配置视图">
          <button type="button" :class="{ active: activeTab === 'proxies' }" @click="activeTab = 'proxies'">代理节点</button>
          <button type="button" :class="{ active: activeTab === 'rules' }" @click="activeTab = 'rules'; updateRulesTableHeight()">分流规则</button>
          <button type="button" :class="{ active: activeTab === 'raw' }" :disabled="hasUnsavedChanges" @click="activeTab = 'raw'; loadRaw()">YAML</button>
        </nav>
        <div class="topbar-actions">
          <el-button
            type="primary"
            :icon="Check"
            :loading="savingChanges"
            :plain="!hasUnsavedChanges"
            @click="saveAllChanges"
          >保存修改</el-button>
          <el-tooltip content="刷新配置" placement="bottom">
            <button type="button" class="topbar-icon" aria-label="刷新配置" @click="refreshContent"><Refresh /></button>
          </el-tooltip>
          <el-tooltip content="退出登录" placement="bottom">
            <button type="button" class="topbar-icon" aria-label="退出登录" @click="logout"><SwitchButton /></button>
          </el-tooltip>
        </div>
      </div>

      <div class="workspace-body">
      <header class="workspace-header">
        <div class="mobile-brand"><div class="brand-mark small">C</div><strong>配置中心</strong></div>
        <div>
          <div class="title-line">
            <h1>{{ currentConfig?.name || '配置' }}</h1>
            <span v-if="currentConfig?.isTemplate" class="template-badge">默认模板</span>
            <span v-if="hasUnsavedChanges" class="unsaved-badge">有未保存修改</span>
          </div>
          <p>{{ currentConfig?.description || '未填写配置说明' }}</p>
        </div>
        <div class="header-actions">
          <el-button :icon="Edit" @click="openEditConfig">编辑资料</el-button>
          <el-button v-if="!currentConfig?.isTemplate" :icon="Delete" type="danger" plain @click="deleteConfig">删除</el-button>
        </div>
      </header>

      <section v-if="subscriptionUrl" class="subscription-strip">
        <div class="subscription-label"><el-icon><Link /></el-icon><span>订阅地址</span></div>
        <code>{{ subscriptionUrl }}</code>
        <el-button :icon="CopyDocument" text @click="copySubscription">复制</el-button>
      </section>
      <section v-else class="template-notice">
        <el-icon><Setting /></el-icon>
        <span>修改这里会影响之后新建的配置，不提供公开订阅地址。</span>
      </section>

      <section class="content-panel" v-loading="contentLoading">
        <el-tabs v-model="activeTab" class="manager-tabs" @tab-change="handleTabChange">
          <el-tab-pane name="proxies">
            <template #label><span>代理节点 <b>{{ content.proxies.length }}</b></span></template>
            <div class="panel-toolbar">
              <el-input v-model="proxyQuery" clearable placeholder="搜索名称、地址或类型" class="table-search">
                <template #prefix><el-icon><Search /></el-icon></template>
              </el-input>
              <el-button type="primary" :icon="Plus" @click="openCreateProxy">添加代理</el-button>
            </div>
            <el-table :data="filteredProxies" row-key="index" class="data-table" empty-text="暂无代理节点">
              <el-table-column label="名称" min-width="180">
                <template #default="{ row }"><strong>{{ row.item.name }}</strong></template>
              </el-table-column>
              <el-table-column label="类型" width="110">
                <template #default="{ row }"><el-tag effect="plain" size="small">{{ row.item.type }}</el-tag></template>
              </el-table-column>
              <el-table-column label="服务器" min-width="220">
                <template #default="{ row }"><code class="cell-code">{{ row.item.server }}</code></template>
              </el-table-column>
              <el-table-column label="端口" width="100">
                <template #default="{ row }">{{ row.item.port }}</template>
              </el-table-column>
              <el-table-column label="传输" width="100">
                <template #default="{ row }">{{ row.item.network || 'tcp' }}</template>
              </el-table-column>
              <el-table-column label="TLS" width="80">
                <template #default="{ row }"><el-icon v-if="row.item.tls" class="status-check"><Check /></el-icon><span v-else>-</span></template>
              </el-table-column>
              <el-table-column label="操作" width="108" fixed="right">
                <template #default="{ row }">
                  <el-button :icon="Edit" text circle aria-label="编辑代理" @click="openEditProxy(row.index)" />
                  <el-button :icon="Delete" text circle type="danger" aria-label="删除代理" @click="deleteProxy(row.index, row.item.name)" />
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane name="rules">
            <template #label><span>分流规则 <b>{{ content.rules.length }}</b></span></template>
            <div class="panel-toolbar">
              <el-input v-model="ruleQuery" clearable placeholder="搜索规则内容或策略" class="table-search">
                <template #prefix><el-icon><Search /></el-icon></template>
              </el-input>
              <el-button type="primary" :icon="Plus" @click="openCreateRule">添加规则</el-button>
            </div>
            <div ref="rulesTableHost" class="rules-table-host" :style="{ height: `${ruleTableHeight}px` }">
              <el-auto-resizer>
                <template #default="{ height, width }">
                  <el-table-v2
                    :columns="ruleColumns"
                    :data="filteredRules"
                    :width="width"
                    :height="height"
                    :row-height="30"
                    :header-height="34"
                    :cache="10"
                    row-key="index"
                    class="rules-virtual-table"
                  >
                    <template #cell="{ column, rowData }">
                      <span v-if="column.key === 'number'" class="row-number">{{ rowData.index + 1 }}</span>

                      <template v-else-if="column.key === 'type'">
                        <el-select
                          v-if="isEditingRule(rowData.index, 'type')"
                          ref="ruleEditorRef"
                          v-model="editingRule.value"
                          size="small"
                          filterable
                          allow-create
                          @change="commitRuleEdit"
                          @blur="commitRuleEdit"
                        >
                          <el-option v-for="type in ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'IP-CIDR6', 'GEOIP', 'GEOSITE', 'PROCESS-NAME', 'RULE-SET', 'MATCH']" :key="type" :value="type" />
                        </el-select>
                        <button v-else type="button" class="editable-cell" @click="startRuleEdit(rowData.index, 'type')">
                          <el-tag effect="plain" size="small">{{ rowData.item.type }}</el-tag>
                        </button>
                      </template>

                      <template v-else-if="column.key === 'payload'">
                        <el-input
                          v-if="isEditingRule(rowData.index, 'payload')"
                          ref="ruleEditorRef"
                          v-model="editingRule.value"
                          size="small"
                          autofocus
                          @blur="commitRuleEdit"
                          @keyup.enter="blurRuleEditor"
                          @keyup.esc="cancelRuleEdit"
                        />
                        <button
                          v-else
                          type="button"
                          class="editable-cell match-cell"
                          :class="{ disabled: ['MATCH', 'FINAL'].includes(rowData.item.type) }"
                          :title="rowData.item.payload || '全部流量'"
                          @click="startRuleEdit(rowData.index, 'payload')"
                        ><code class="cell-code">{{ rowData.item.payload || '全部流量' }}</code></button>
                      </template>

                      <template v-else-if="column.key === 'policy'">
                        <el-select
                          v-if="isEditingRule(rowData.index, 'policy')"
                          ref="ruleEditorRef"
                          v-model="editingRule.value"
                          size="small"
                          filterable
                          allow-create
                          @change="commitRuleEdit"
                          @blur="commitRuleEdit"
                        >
                          <el-option v-for="policy in content.policyOptions" :key="policy" :value="policy" :label="policy" />
                        </el-select>
                        <button v-else type="button" class="editable-cell" @click="startRuleEdit(rowData.index, 'policy')">
                          <span class="policy-pill" :class="{ direct: rowData.item.policy === 'DIRECT' }">{{ rowData.item.policy }}</span>
                        </button>
                      </template>

                      <template v-else-if="column.key === 'options'">
                        <el-input
                          v-if="isEditingRule(rowData.index, 'options')"
                          ref="ruleEditorRef"
                          v-model="editingRule.value"
                          size="small"
                          autofocus
                          @blur="commitRuleEdit"
                          @keyup.enter="blurRuleEditor"
                          @keyup.esc="cancelRuleEdit"
                        />
                        <button v-else type="button" class="editable-cell" @click="startRuleEdit(rowData.index, 'options')">{{ rowData.item.options.join(', ') || '-' }}</button>
                      </template>

                      <el-button
                        v-else-if="column.key === 'actions'"
                        :icon="Delete"
                        text
                        circle
                        type="danger"
                        aria-label="删除规则"
                        @click="deleteRule(rowData.index)"
                      />
                    </template>
                    <template #empty><div class="rules-empty">暂无分流规则</div></template>
                  </el-table-v2>
                </template>
              </el-auto-resizer>
            </div>
          </el-tab-pane>

          <el-tab-pane name="raw" :disabled="hasUnsavedChanges">
            <template #label><span>原始 YAML</span></template>
            <div class="raw-toolbar">
              <div><strong>完整配置</strong><span>保存前会校验 YAML 语法和必要字段。</span></div>
              <div><el-button :icon="Refresh" @click="loadRaw">重新载入</el-button><el-button type="primary" :loading="rawSaving" @click="saveRaw">保存 YAML</el-button></div>
            </div>
            <el-input
              v-model="rawYaml"
              v-loading="rawLoading"
              type="textarea"
              class="yaml-editor"
              :autosize="{ minRows: 22, maxRows: 36 }"
              spellcheck="false"
            />
          </el-tab-pane>
        </el-tabs>
      </section>
      </div>
    </main>

    <el-dialog v-model="configDialog.visible" :title="configDialog.editing ? '编辑配置资料' : '新建配置'" width="500px">
      <el-form label-position="top">
        <el-form-item label="配置名称" required><el-input v-model="configForm.name" placeholder="例如：日本代理" /></el-form-item>
        <el-form-item v-if="!configDialog.editing" label="订阅路由标识" required>
          <el-input v-model="configForm.id" placeholder="例如：japan"><template #prepend>/subscribe/</template></el-input>
        </el-form-item>
        <el-form-item label="说明"><el-input v-model="configForm.description" type="textarea" :rows="3" placeholder="这份配置的用途或节点说明" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="configDialog.visible = false">取消</el-button><el-button type="primary" :loading="configDialog.saving" @click="saveConfig">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="proxyDialog.visible" :title="proxyDialog.index < 0 ? '添加代理' : '编辑代理'" width="720px" class="form-dialog">
      <el-form label-position="top">
        <div class="form-grid">
          <el-form-item label="名称" required><el-input v-model="proxyForm.name" /></el-form-item>
          <el-form-item label="类型" required>
            <el-select v-model="proxyForm.type" filterable allow-create><el-option v-for="type in ['vmess', 'vless', 'ss', 'trojan', 'socks5', 'http']" :key="type" :value="type" /></el-select>
          </el-form-item>
          <el-form-item label="服务器" required><el-input v-model="proxyForm.server" /></el-form-item>
          <el-form-item label="端口" required><el-input-number v-model="proxyForm.port" :min="1" :max="65535" controls-position="right" /></el-form-item>
          <el-form-item v-if="['vmess', 'vless'].includes(proxyForm.type)" label="UUID"><el-input v-model="proxyForm.uuid" /></el-form-item>
          <el-form-item v-if="['ss', 'trojan', 'socks5', 'http'].includes(proxyForm.type)" label="密码"><el-input v-model="proxyForm.password" show-password /></el-form-item>
          <el-form-item v-if="['vmess', 'ss'].includes(proxyForm.type)" label="加密方式"><el-input v-model="proxyForm.cipher" placeholder="auto" /></el-form-item>
          <el-form-item v-if="proxyForm.type === 'vmess'" label="Alter ID"><el-input-number v-model="proxyForm.alterId" :min="0" controls-position="right" /></el-form-item>
          <el-form-item label="传输方式"><el-select v-model="proxyForm.network" clearable><el-option value="tcp" /><el-option value="ws" /><el-option value="grpc" /><el-option value="h2" /></el-select></el-form-item>
          <el-form-item label="连接选项" class="switch-field"><el-checkbox v-model="proxyForm.tls">TLS</el-checkbox><el-checkbox v-model="proxyForm.skipCertVerify">跳过证书验证</el-checkbox></el-form-item>
          <el-form-item v-if="proxyForm.network === 'ws'" label="WebSocket 路径"><el-input v-model="proxyForm.wsPath" placeholder="/path" /></el-form-item>
          <el-form-item v-if="proxyForm.network === 'ws'" label="WebSocket Host"><el-input v-model="proxyForm.wsHost" /></el-form-item>
        </div>
        <el-collapse class="advanced-collapse">
          <el-collapse-item title="高级配置（JSON）" name="advanced">
            <el-input v-model="proxyForm.extra" type="textarea" :rows="7" spellcheck="false" />
          </el-collapse-item>
        </el-collapse>
      </el-form>
      <template #footer><el-button @click="proxyDialog.visible = false">取消</el-button><el-button type="primary" :loading="proxyDialog.saving" @click="saveProxy">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="ruleDialog.visible" title="添加规则" width="560px">
      <el-form label-position="top">
        <el-form-item label="规则类型" required>
          <el-select v-model="ruleForm.type" filterable allow-create>
            <el-option v-for="type in ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'IP-CIDR6', 'GEOIP', 'GEOSITE', 'PROCESS-NAME', 'RULE-SET', 'MATCH']" :key="type" :value="type" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="!['MATCH', 'FINAL'].includes(ruleForm.type)" label="匹配内容" required><el-input v-model="ruleForm.payload" placeholder="例如：example.com" /></el-form-item>
        <el-form-item label="处理策略" required>
          <el-select v-model="ruleForm.policy" filterable allow-create>
            <el-option v-for="policy in content.policyOptions" :key="policy" :value="policy" :label="policy" />
          </el-select>
        </el-form-item>
        <el-form-item label="附加参数"><el-input v-model="ruleForm.options" placeholder="例如：no-resolve，多个参数用逗号分隔" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="ruleDialog.visible = false">取消</el-button><el-button type="primary" :loading="ruleDialog.saving" @click="saveRule">保存</el-button></template>
    </el-dialog>
  </div>
</template>
