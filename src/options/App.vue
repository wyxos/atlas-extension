<script setup>
import { onBeforeUnmount, onMounted } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import { toast } from "vue-sonner";
import "vue-sonner/style.css";
import { Button } from "@ui/button";
import { Toaster } from "@ui/sonner";
import {
  settingsSyncPreferencesKey,
  settingsSyncStatuses,
} from "../shared/settings-sync";

const route = useRoute();

const navigationItems = [
  {
    label: "Settings",
    to: "/settings",
  },
  {
    label: "Overview",
    to: "/",
  },
  {
    label: "Profiles",
    to: "/profiles",
  },
  {
    label: "Logs",
    to: "/logs",
  },
];

const settingsSyncMessages = {
  [settingsSyncStatuses.downloaded]: "Settings synced from Atlas.",
  [settingsSyncStatuses.uploaded]: "Settings synced to Atlas.",
};

onMounted(() => {
  if (typeof globalThis.chrome?.storage?.onChanged?.addListener === "function") {
    globalThis.chrome.storage.onChanged.addListener(handleSettingsSyncPreferenceChange);
  }
});

onBeforeUnmount(() => {
  if (typeof globalThis.chrome?.storage?.onChanged?.removeListener === "function") {
    globalThis.chrome.storage.onChanged.removeListener(handleSettingsSyncPreferenceChange);
  }
});

function handleSettingsSyncPreferenceChange(changes, areaName) {
  if (areaName !== "local" || route.name === "settings") {
    return;
  }

  const change = changes?.[settingsSyncPreferencesKey];
  const newValue = change?.newValue;
  const oldValue = change?.oldValue;

  if (!newValue || !oldValue) {
    return;
  }

  if (newValue.lastStatus === settingsSyncStatuses.conflict) {
    if (oldValue.lastStatus !== settingsSyncStatuses.conflict) {
      toast.error("Settings conflict detected.", {
        description: newValue.lastError || "Open Settings to choose Download, Upload, or Merge.",
      });
    }

    return;
  }

  if (newValue.lastStatus === settingsSyncStatuses.failed) {
    if (newValue.lastError !== "" && newValue.lastError !== oldValue.lastError) {
      toast.error("Settings sync failed.", {
        description: newValue.lastError,
      });
    }

    return;
  }

  if (newValue.lastSyncedAt === oldValue.lastSyncedAt) {
    return;
  }

  const message = settingsSyncMessages[newValue.lastStatus];

  if (message) {
    toast.success(message);
  }
}
</script>

<template>
  <main class="h-screen w-screen bg-background text-foreground p-6">
    <section class="flex h-full w-full flex-col">
      <header class="border-b border-border pb-3">
        <h1 class="text-2xl font-semibold leading-tight text-regal-navy-100">
          Atlas Extension
        </h1>
        <p class="text-base text-blue-slate-300">
          Manage Atlas extension settings.
        </p>
        <nav class="mt-4 flex flex-wrap gap-1" aria-label="Options sections">
          <RouterLink
            v-for="item in navigationItems"
            :key="item.to"
            v-slot="{ href, navigate, isExactActive }"
            :to="item.to"
            custom
          >
            <Button
              as="a"
              :href="href"
              size="sm"
              :variant="isExactActive ? 'secondary' : 'ghost'"
              @click="navigate"
            >
              {{ item.label }}
            </Button>
          </RouterLink>
        </nav>
      </header>

      <div class="flex min-h-0 w-full flex-1 pt-4">
        <RouterView />
      </div>
    </section>
    <Toaster rich-colors position="bottom-right" />
  </main>
</template>
