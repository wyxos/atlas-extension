<script setup>
import { computed, onMounted, ref } from "vue";
import { Download, FileDown, FileUp, RefreshCw, Upload } from "@lucide/vue";
import { toast } from "vue-sonner";
import { Badge } from "@ui/badge";
import { Button } from "@ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@ui/field";
import { Separator } from "@ui/separator";
import {
  applySettingsBundle,
  buildSettingsBundle,
  parseSettingsBundleJson,
} from "../../shared/settings-bundle";
import {
  downloadSettingsFromRemote,
  loadSettingsSyncPreferences,
  mergeSettingsWithRemote,
  setSettingsSyncEnabled,
  syncExtensionSettings,
  settingsSyncStatuses,
  uploadSettingsToRemote,
} from "../../shared/settings-sync";

const fileInput = ref(null);
const isBusy = ref(false);
const syncPreferences = ref(null);

const syncEnabled = computed(() => syncPreferences.value?.enabled === true);
const lastSyncedLabel = computed(() => {
  const value = syncPreferences.value?.lastSyncedAt;

  if (typeof value !== "string" || value === "") {
    return "Not synced";
  }

  return new Date(value).toLocaleString();
});
const syncStatusLabel = computed(() => syncPreferences.value?.lastStatus ?? "idle");
const syncConflict = computed(() => syncPreferences.value?.conflict ?? null);
const syncConflictDifferenceLabel = computed(() => {
  const labels = syncConflict.value?.differences?.map((difference) => difference.label) ?? [];

  return labels.length === 0 ? "Settings data" : labels.join(", ");
});

onMounted(loadSyncPreferences);

async function loadSyncPreferences() {
  syncPreferences.value = await loadSettingsSyncPreferences();
}

async function exportSettings() {
  await runAction(async () => {
    const bundle = await buildSettingsBundle();
    const blob = new globalThis.Blob([`${JSON.stringify(bundle, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `atlas-extension-settings-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);

    return "Settings exported.";
  });
}

function triggerImport() {
  fileInput.value?.click();
}

async function importSettings(event) {
  const file = event.target.files?.[0] ?? null;

  event.target.value = "";

  if (file === null) {
    return;
  }

  await runAction(async () => {
    const bundle = parseSettingsBundleJson(await file.text());

    await applySettingsBundle(bundle);
    await loadSyncPreferences();

    if (syncEnabled.value) {
      const result = await syncSettingsAfterAction();

      if (result.status === settingsSyncStatuses.conflict) {
        showSyncConflictToast();

        return "";
      }
    }

    return "Settings imported.";
  });
}

async function uploadSettings() {
  await runAction(async () => {
    await uploadSettingsToRemote();
    await loadSyncPreferences();

    return "Settings uploaded.";
  });
}

async function downloadSettings() {
  await runAction(async () => {
    const result = await downloadSettingsFromRemote();

    await loadSyncPreferences();
    return result.settings === null
      ? "No remote settings found."
      : "Settings downloaded.";
  });
}

async function mergeSettings() {
  await runAction(async () => {
    await mergeSettingsWithRemote();
    await loadSyncPreferences();

    return "Settings merged.";
  });
}

async function toggleSync(event) {
  const enabled = event.target.checked === true;

  await runAction(async () => {
    syncPreferences.value = await setSettingsSyncEnabled(enabled);

    if (enabled) {
      const result = await syncSettingsAfterAction();
      await loadSyncPreferences();

      if (result.status === settingsSyncStatuses.conflict) {
        showSyncConflictToast();

        return "";
      }

      return "Sync enabled.";
    }

    return "Sync disabled.";
  });
}

async function runAction(action) {
  isBusy.value = true;

  try {
    const message = await action();

    if (typeof message === "string" && message !== "") {
      toast.success(message);
    }
  } catch (error) {
    toast.error("Settings action failed.", {
      description: error?.message ?? "Settings action failed.",
    });
  } finally {
    isBusy.value = false;
  }
}

async function syncSettingsAfterAction() {
  const result = await syncExtensionSettings();

  if (result.status === settingsSyncStatuses.failed) {
    throw new Error(result.error ?? "Settings sync failed.");
  }

  return result;
}

function showSyncConflictToast() {
  toast.error("Settings conflict detected.", {
    description: "Choose Download, Upload, or Merge before sync continues.",
  });
}
</script>

<template>
  <section class="flex w-full max-w-3xl flex-col gap-5">
    <input
      id="settings-file-input"
      ref="fileInput"
      accept="application/json"
      class="hidden"
      type="file"
      @change="importSettings"
    >

    <FieldGroup class="gap-4">
      <Field class="gap-2">
        <FieldLabel>
          File
        </FieldLabel>
        <FieldDescription class="text-xs">
          Exported files include the API key. Keep them private.
        </FieldDescription>
        <div class="flex flex-wrap gap-2">
          <Button type="button" size="sm" :disabled="isBusy" @click="exportSettings">
            <FileDown data-icon="inline-start" />
            Export
          </Button>
          <Button type="button" variant="outline" size="sm" :disabled="isBusy" @click="triggerImport">
            <FileUp data-icon="inline-start" />
            Import
          </Button>
        </div>
      </Field>

      <Separator />

      <Field class="gap-2">
        <FieldLabel>
          Remote
        </FieldLabel>
        <FieldDescription class="text-xs">
          Upload and sync use the connected Atlas domain and do not store the API key remotely.
        </FieldDescription>
        <div class="flex flex-wrap gap-2">
          <Button type="button" size="sm" :disabled="isBusy" @click="uploadSettings">
            <Upload data-icon="inline-start" />
            Upload
          </Button>
          <Button type="button" variant="outline" size="sm" :disabled="isBusy" @click="downloadSettings">
            <Download data-icon="inline-start" />
            Download
          </Button>
        </div>
      </Field>

      <Separator />

      <Field class="gap-2">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <FieldLabel for="atlas-settings-sync-toggle">
              Sync
            </FieldLabel>
            <FieldDescription class="text-xs">
              When enabled, startup compares local and Atlas settings before syncing.
            </FieldDescription>
          </div>
          <label class="inline-flex items-center gap-2 text-sm">
            <input
              id="atlas-settings-sync-toggle"
              :checked="syncEnabled"
              :disabled="isBusy"
              class="h-4 w-4 rounded border-border accent-primary"
              type="checkbox"
              @change="toggleSync"
            >
            Enabled
          </label>
        </div>
        <div class="flex flex-wrap items-center gap-2 pt-1">
          <Badge variant="outline">
            {{ syncStatusLabel }}
          </Badge>
          <span class="text-xs text-muted-foreground">
            {{ lastSyncedLabel }}
          </span>
          <RefreshCw v-if="isBusy" class="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </Field>

      <Field v-if="syncConflict !== null" class="gap-2 rounded-md border border-destructive/50 p-3">
        <FieldLabel>
          Settings conflict
        </FieldLabel>
        <FieldDescription class="text-xs">
          Atlas and this browser have different settings. Changed: {{ syncConflictDifferenceLabel }}.
        </FieldDescription>
        <div class="flex flex-wrap gap-2 pt-1">
          <Button type="button" size="sm" :disabled="isBusy" @click="downloadSettings">
            <Download data-icon="inline-start" />
            Download from Atlas
          </Button>
          <Button type="button" variant="outline" size="sm" :disabled="isBusy" @click="uploadSettings">
            <Upload data-icon="inline-start" />
            Upload local
          </Button>
          <Button type="button" variant="outline" size="sm" :disabled="isBusy" @click="mergeSettings">
            <RefreshCw data-icon="inline-start" />
            Merge
          </Button>
        </div>
      </Field>
    </FieldGroup>
  </section>
</template>
