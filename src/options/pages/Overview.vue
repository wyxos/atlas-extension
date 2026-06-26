<script setup>
import { computed, onMounted, ref } from "vue";
import { Eye, EyeOff, Plug, RefreshCw } from "@lucide/vue";
import { Badge } from "@ui/badge";
import { Button } from "@ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@ui/field";
import { Input } from "@ui/input";
import {
  connectAndSaveConnectionConfig,
  connectionModes,
  defaultApiKey,
  connectionStatuses,
  defaultDomain,
  getReverbStatusLabel,
  getReverbStatusVariant,
  getStatusLabel,
  getStatusVariant,
  isConnectableConfig,
  loadConnectionState,
  localApiKey,
  localDomain,
  resolveActiveConnectionConfig,
  saveConnectionMode,
  reverbStatuses,
} from "../connection";

const mode = ref(connectionModes.live);
const liveDomain = ref(defaultDomain);
const liveApiKey = ref(defaultApiKey);
const status = ref(connectionStatuses.idle);
const isConnecting = ref(false);
const isRefreshing = ref(false);
const showApiKey = ref(false);
const reverbStatus = ref(reverbStatuses.idle);

const isLocalMode = computed(() => mode.value === connectionModes.local);
const hasFailed = computed(() => status.value === connectionStatuses.failed);
const apiKeyInputType = computed(() => showApiKey.value ? "text" : "password");
const apiKeyToggleLabel = computed(() => showApiKey.value ? "Hide API key" : "Show API key");
const failureMessage = computed(() => reverbStatus.value === reverbStatuses.failed
  ? "Atlas API connected, but Reverb did not complete a connection handshake."
  : "Enter a valid HTTP(S) domain and API key.");
const isBusy = computed(() => isConnecting.value || isRefreshing.value);
const activeConfig = computed(() => ({
  apiKey: isLocalMode.value ? localApiKey : liveApiKey.value,
  domain: isLocalMode.value ? localDomain : liveDomain.value,
  mode: mode.value,
}));
const displayDomain = computed({
  get: () => activeConfig.value.domain,
  set: (value) => {
    if (!isLocalMode.value) {
      liveDomain.value = value;
    }
  },
});
const displayApiKey = computed({
  get: () => activeConfig.value.apiKey,
  set: (value) => {
    if (!isLocalMode.value) {
      liveApiKey.value = value;
    }
  },
});
const canRefresh = computed(() => isConnectableConfig(activeConfig.value));
const reverbStatusLabel = computed(() => getReverbStatusLabel(reverbStatus.value));
const reverbStatusVariant = computed(() => getReverbStatusVariant(reverbStatus.value));
const statusLabel = computed(() => getStatusLabel(status.value));
const statusVariant = computed(() => getStatusVariant(status.value));

let hasLoadedConnection = false;
let hasAutoCheckedConnection = false;

onMounted(initializeConnection);

async function initializeConnection() {
  await loadStoredConnectionOnce();
  await autoCheckConnectionOnce();
}

async function loadStoredConnectionOnce() {
  if (hasLoadedConnection) {
    return;
  }

  hasLoadedConnection = true;

  try {
    const storedState = await loadConnectionState();
    applyConnectionState(storedState);
  } catch {
    status.value = connectionStatuses.failed;
  }
}

async function connect() {
  isConnecting.value = true;
  try {
    await verifyAndStoreConnection();
  } finally {
    isConnecting.value = false;
  }
}

async function refreshConnection() {
  isRefreshing.value = true;
  try {
    await verifyAndStoreConnection();
  } finally {
    isRefreshing.value = false;
  }
}

async function autoCheckConnectionOnce() {
  if (hasAutoCheckedConnection || !isConnectableConfig(activeConfig.value)) {
    return;
  }

  hasAutoCheckedConnection = true;
  isRefreshing.value = true;

  try {
    await verifyAndStoreConnection();
  } finally {
    isRefreshing.value = false;
  }
}

async function verifyAndStoreConnection() {
  try {
    const storedConfig = await connectAndSaveConnectionConfig(activeConfig.value);

    applyConnectionConfig(storedConfig);
  } catch {
    status.value = connectionStatuses.failed;
    reverbStatus.value = reverbStatuses.failed;
  }
}

async function setConnectionMode(nextMode) {
  if (mode.value === nextMode || isBusy.value) {
    return;
  }

  const previousLiveDomain = liveDomain.value;
  const previousLiveApiKey = liveApiKey.value;

  try {
    const state = await saveConnectionMode(nextMode);

    applyConnectionState(state);
    liveDomain.value = previousLiveDomain;
    liveApiKey.value = previousLiveApiKey;
  } catch {
    status.value = connectionStatuses.failed;
    reverbStatus.value = reverbStatuses.failed;

    return;
  }

  if (nextMode === connectionModes.local) {
    await refreshConnection();
  }
}

function applyConnectionState(state) {
  const activeStoredConfig = resolveActiveConnectionConfig(state);

  mode.value = state.mode;
  liveDomain.value = state.profiles.live.domain ?? defaultDomain;
  liveApiKey.value = state.profiles.live.apiKey ?? defaultApiKey;
  applyConnectionConfig(activeStoredConfig);
}

function applyConnectionConfig(config) {
  if (config.mode === connectionModes.live) {
    liveDomain.value = config.domain ?? defaultDomain;
    liveApiKey.value = config.apiKey ?? defaultApiKey;
  }

  status.value = config.status ?? connectionStatuses.idle;
  reverbStatus.value = config.reverb?.status ?? reverbStatuses.idle;
}
</script>

<template>
  <form class="w-full max-w-md" @submit.prevent="connect">
    <FieldGroup class="gap-3">
      <Field class="gap-1.5">
        <FieldLabel>
          Connection
        </FieldLabel>
        <div class="inline-flex w-fit rounded-md border border-border bg-background p-0.5">
          <Button
            type="button"
            size="sm"
            :variant="mode === connectionModes.live ? 'secondary' : 'ghost'"
            :disabled="isBusy"
            @click="setConnectionMode(connectionModes.live)"
          >
            Live
          </Button>
          <Button
            type="button"
            size="sm"
            :variant="isLocalMode ? 'secondary' : 'ghost'"
            :disabled="isBusy"
            @click="setConnectionMode(connectionModes.local)"
          >
            Local
          </Button>
        </div>
      </Field>
      <Field class="gap-1.5" :data-invalid="hasFailed || undefined">
        <FieldLabel for="atlas-domain">
          Domain
        </FieldLabel>
        <Input
          id="atlas-domain"
          v-model="displayDomain"
          autocomplete="url"
          class="h-7 text-sm"
          :disabled="isLocalMode"
          :placeholder="isLocalMode ? localDomain : 'https://atlas.example.com'"
          :aria-invalid="hasFailed || undefined"
        />
      </Field>
      <Field class="gap-1.5" :data-invalid="hasFailed || undefined">
        <FieldLabel for="atlas-api-key">
          API key
        </FieldLabel>
        <div class="relative">
          <Input
            id="atlas-api-key"
            v-model="displayApiKey"
            autocomplete="off"
            class="h-7 pr-8 text-sm"
            :disabled="isLocalMode"
            :type="apiKeyInputType"
            :aria-invalid="hasFailed || undefined"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="absolute right-0 top-0"
            :aria-label="apiKeyToggleLabel"
            :title="apiKeyToggleLabel"
            @click="showApiKey = !showApiKey"
          >
            <EyeOff v-if="showApiKey" />
            <Eye v-else />
          </Button>
        </div>
        <FieldDescription class="text-xs">
          Local mode uses atlas.test with the seeded API key and keeps live settings untouched.
        </FieldDescription>
        <FieldDescription v-if="hasFailed" class="text-xs">
          {{ failureMessage }}
        </FieldDescription>
      </Field>
      <Field orientation="horizontal" class="flex-wrap gap-2 pt-1">
        <Button type="submit" size="sm" :disabled="isBusy">
          <Plug data-icon="inline-start" />
          Connect
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="isBusy || !canRefresh"
          @click="refreshConnection"
        >
          <RefreshCw
            data-icon="inline-start"
            :class="{ 'animate-spin': isRefreshing }"
          />
          Refresh
        </Button>
        <Badge :variant="statusVariant" aria-live="polite">
          {{ statusLabel }}
        </Badge>
        <Badge :variant="reverbStatusVariant" aria-live="polite">
          {{ reverbStatusLabel }}
        </Badge>
      </Field>
    </FieldGroup>
  </form>
</template>
