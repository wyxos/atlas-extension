<script setup>
import { computed, onMounted, ref } from "vue";
import { Eye, EyeOff, Plug, RefreshCw } from "@lucide/vue";
import { Badge } from "@ui/badge";
import { Button } from "@ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@ui/field";
import { Input } from "@ui/input";
import {
  connectAndSaveConnectionConfig,
  defaultApiKey,
  connectionStatuses,
  defaultDomain,
  getReverbStatusLabel,
  getReverbStatusVariant,
  getStatusLabel,
  getStatusVariant,
  isConnectableConfig,
  loadConnectionConfig,
  reverbStatuses,
} from "../connection";

const domain = ref(defaultDomain);
const apiKey = ref(defaultApiKey);
const status = ref(connectionStatuses.idle);
const isConnecting = ref(false);
const isRefreshing = ref(false);
const hasStoredConnection = ref(false);
const showApiKey = ref(false);
const reverbStatus = ref(reverbStatuses.idle);

const hasFailed = computed(() => status.value === connectionStatuses.failed);
const apiKeyInputType = computed(() => showApiKey.value ? "text" : "password");
const apiKeyToggleLabel = computed(() => showApiKey.value ? "Hide API key" : "Show API key");
const failureMessage = computed(() => reverbStatus.value === reverbStatuses.failed
  ? "Atlas API connected, but Reverb did not complete a connection handshake."
  : "Enter a valid HTTP(S) domain and API key.");
const isBusy = computed(() => isConnecting.value || isRefreshing.value);
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
    const storedConfig = await loadConnectionConfig();

    if (storedConfig !== null) {
      domain.value = storedConfig.domain ?? defaultDomain;
      apiKey.value = storedConfig.apiKey ?? defaultApiKey;
      status.value = storedConfig.status ?? connectionStatuses.connected;
      reverbStatus.value = storedConfig.reverb?.status ?? reverbStatuses.idle;
      hasStoredConnection.value = true;
    }
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
  if (hasAutoCheckedConnection || !isConnectableConfig({
    apiKey: apiKey.value,
    domain: domain.value,
  })) {
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
    const storedConfig = await connectAndSaveConnectionConfig({
      apiKey: apiKey.value,
      domain: domain.value,
    });

    domain.value = storedConfig.domain;
    apiKey.value = storedConfig.apiKey;
    status.value = storedConfig.status;
    reverbStatus.value = storedConfig.reverb?.status ?? reverbStatuses.idle;
    hasStoredConnection.value = true;
  } catch {
    status.value = connectionStatuses.failed;
    reverbStatus.value = reverbStatuses.failed;
  }
}
</script>

<template>
  <form class="w-full max-w-md" @submit.prevent="connect">
    <FieldGroup class="gap-3">
      <Field class="gap-1.5" :data-invalid="hasFailed || undefined">
        <FieldLabel for="atlas-domain">
          Domain
        </FieldLabel>
        <Input
          id="atlas-domain"
          v-model="domain"
          autocomplete="url"
          class="h-7 text-sm"
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
            v-model="apiKey"
            autocomplete="off"
            class="h-7 pr-8 text-sm"
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
          The default API key comes from the Atlas local database seeder.
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
          :disabled="isBusy || !hasStoredConnection"
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
