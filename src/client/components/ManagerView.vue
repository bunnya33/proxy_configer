<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowDown,
  ArrowUp,
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
const rulePage = ref(1);
const rulePageSize = ref(20);
const rawYaml = ref('');
const rawLoading = ref(false);
const rawSaving = ref(false);

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
const ruleDialog = reactive({ visible: false, index: -1, saving: false });
const ruleForm = reactive({ type: 'DOMAIN-SUFFIX', payload: '', policy: 'DIRECT', options: '' });

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
const pagedRules = computed(() => {
  const start = (rulePage.value - 1) * rulePageSize.value;
  return filteredRules.value.slice(start, start + rulePageSize.value);
});
const subscriptionUrl = computed(() =>
  currentConfig.value?.subscribeUrl ? `${window.location.origin}${currentConfig.value.subscribeUrl}` : ''
);

watch(ruleQuery, () => (rulePage.value = 1));
watch(rulePageSize, () => (rulePage.value = 1));

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
    rulePage.value = 1;
    if (activeTab.value === 'raw') await loadRaw();
  } catch (error) {
    errorMessage(error);
  } finally {
    contentLoading.value = false;
  }
}

async function selectConfig(id: string) {
  if (id === currentId.value) return;
  currentId.value = id;
  rawYaml.value = '';
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

function openEditProxy(index: number) {
  const source = structuredClone(content.value.proxies[index]);
  const wsOpts = (source['ws-opts'] ?? {}) as Record<string, unknown>;
  const headers = (wsOpts.headers ?? {}) as Record<string, unknown>;
  const extra = structuredClone(source);
  const known = ['name', 'type', 'server', 'port', 'uuid', 'password', 'cipher', 'alterId', 'tls', 'skip-cert-verify', 'network'];
  known.forEach((key) => delete extra[key]);
  delete extra['ws-opts'];
  const remainingWs = structuredClone(wsOpts);
  delete remainingWs.path;
  if (remainingWs.headers && typeof remainingWs.headers === 'object') {
    const remainingHeaders = structuredClone(remainingWs.headers as Record<string, unknown>);
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

async function saveProxy() {
  if (!proxyForm.name.trim() || !proxyForm.type || !proxyForm.server.trim() || !proxyForm.port) {
    ElMessage.warning('请填写名称、类型、服务器和端口');
    return;
  }
  proxyDialog.saving = true;
  try {
    const proxy = buildProxy();
    const path =
      proxyDialog.index < 0
        ? `/api/configs/${currentId.value}/proxies`
        : `/api/configs/${currentId.value}/proxies/${proxyDialog.index}`;
    await api(path, { method: proxyDialog.index < 0 ? 'POST' : 'PUT', body: JSON.stringify(proxy) });
    await loadContent();
    proxyDialog.visible = false;
    ElMessage.success(proxyDialog.index < 0 ? '代理已添加' : '代理已更新');
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
    await api(`/api/configs/${currentId.value}/proxies/${index}`, { method: 'DELETE' });
    await loadContent();
    ElMessage.success('代理已删除');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') errorMessage(error);
  }
}

function openCreateRule() {
  Object.assign(ruleForm, { type: 'DOMAIN-SUFFIX', payload: '', policy: content.value.policyOptions[0] ?? 'DIRECT', options: '' });
  Object.assign(ruleDialog, { visible: true, index: -1 });
}

function openEditRule(index: number) {
  const rule = content.value.rules[index];
  Object.assign(ruleForm, {
    type: rule.type,
    payload: rule.payload,
    policy: rule.policy,
    options: rule.options.join(',')
  });
  Object.assign(ruleDialog, { visible: true, index });
}

async function saveRule() {
  if (!ruleForm.type || !ruleForm.policy || (!['MATCH', 'FINAL'].includes(ruleForm.type) && !ruleForm.payload.trim())) {
    ElMessage.warning('请完整填写规则');
    return;
  }
  ruleDialog.saving = true;
  try {
    const path =
      ruleDialog.index < 0
        ? `/api/configs/${currentId.value}/rules`
        : `/api/configs/${currentId.value}/rules/${ruleDialog.index}`;
    await api(path, { method: ruleDialog.index < 0 ? 'POST' : 'PUT', body: JSON.stringify(ruleForm) });
    await loadContent();
    ruleDialog.visible = false;
    ElMessage.success(ruleDialog.index < 0 ? '规则已添加' : '规则已更新');
  } catch (error) {
    errorMessage(error);
  } finally {
    ruleDialog.saving = false;
  }
}

async function deleteRule(index: number) {
  try {
    await api(`/api/configs/${currentId.value}/rules/${index}`, { method: 'DELETE' });
    await loadContent();
    const maxPage = Math.max(1, Math.ceil(filteredRules.value.length / rulePageSize.value));
    rulePage.value = Math.min(rulePage.value, maxPage);
    ElMessage.success('规则已删除');
  } catch (error) {
    errorMessage(error);
  }
}

async function moveRule(index: number, direction: 'up' | 'down') {
  try {
    await api(`/api/configs/${currentId.value}/rules/${index}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction })
    });
    await loadContent();
  } catch (error) {
    errorMessage(error);
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
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    emit('logout');
  }
}

onMounted(async () => {
  try {
    await loadConfigs('singapore');
    await loadContent();
  } catch (error) {
    errorMessage(error);
  } finally {
    initialLoading.value = false;
  }
});
</script>

<template>
  <div class="manager-shell" v-loading.fullscreen.lock="initialLoading">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-mark small">C</div>
        <div><strong>Clash 配置中心</strong><span>订阅管理后台</span></div>
      </div>
      <div class="sidebar-search">
        <el-input v-model="sidebarQuery" clearable placeholder="查找配置">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
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
      <header class="workspace-header">
        <div class="mobile-brand"><div class="brand-mark small">C</div><strong>配置中心</strong></div>
        <div>
          <div class="title-line">
            <h1>{{ currentConfig?.name || '配置' }}</h1>
            <span v-if="currentConfig?.isTemplate" class="template-badge">默认模板</span>
          </div>
          <p>{{ currentConfig?.description || '未填写配置说明' }}</p>
        </div>
        <div class="header-actions">
          <el-tooltip content="刷新" placement="bottom">
            <el-button :icon="Refresh" circle aria-label="刷新" @click="loadContent" />
          </el-tooltip>
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
            <el-table :data="pagedRules" row-key="index" class="data-table" empty-text="暂无分流规则">
              <el-table-column label="#" width="64">
                <template #default="{ row }"><span class="row-number">{{ row.index + 1 }}</span></template>
              </el-table-column>
              <el-table-column label="类型" width="150">
                <template #default="{ row }"><el-tag effect="plain" size="small">{{ row.item.type }}</el-tag></template>
              </el-table-column>
              <el-table-column label="匹配内容" min-width="260" show-overflow-tooltip>
                <template #default="{ row }"><code class="cell-code">{{ row.item.payload || '全部流量' }}</code></template>
              </el-table-column>
              <el-table-column label="策略" width="170">
                <template #default="{ row }">
                  <span class="policy-pill" :class="{ direct: row.item.policy === 'DIRECT' }">{{ row.item.policy }}</span>
                </template>
              </el-table-column>
              <el-table-column label="附加参数" width="130">
                <template #default="{ row }">{{ row.item.options.join(', ') || '-' }}</template>
              </el-table-column>
              <el-table-column label="操作" width="180" fixed="right">
                <template #default="{ row }">
                  <el-tooltip content="上移" placement="top"><el-button :icon="ArrowUp" text circle :disabled="Boolean(ruleQuery) || row.index === 0" @click="moveRule(row.index, 'up')" /></el-tooltip>
                  <el-tooltip content="下移" placement="top"><el-button :icon="ArrowDown" text circle :disabled="Boolean(ruleQuery) || row.index === content.rules.length - 1" @click="moveRule(row.index, 'down')" /></el-tooltip>
                  <el-button :icon="Edit" text circle aria-label="编辑规则" @click="openEditRule(row.index)" />
                  <el-button :icon="Delete" text circle type="danger" aria-label="删除规则" @click="deleteRule(row.index)" />
                </template>
              </el-table-column>
            </el-table>
            <div class="pagination-row">
              <span>共 {{ filteredRules.length }} 条</span>
              <el-pagination
                v-model:current-page="rulePage"
                v-model:page-size="rulePageSize"
                :page-sizes="[20, 50, 100]"
                :total="filteredRules.length"
                layout="sizes, prev, pager, next"
                background
              />
            </div>
          </el-tab-pane>

          <el-tab-pane name="raw">
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

    <el-dialog v-model="ruleDialog.visible" :title="ruleDialog.index < 0 ? '添加规则' : '编辑规则'" width="560px">
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
