<script setup>
import { computed, onMounted, ref } from "vue";
import { Plus, Trash2 } from "@lucide/vue";
import { Button } from "@ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@ui/field";
import { Input } from "@ui/input";
import {
  addAssetSourceDomain,
  filterAssetSourceDomains,
  loadAssetSourcePreferences,
  removeAssetSourceDomain,
} from "../../shared/asset-source-preferences";

const domainInput = ref("");
const filterInput = ref("");
const domains = ref([]);
const errorMessage = ref("");
const isSaving = ref(false);

const canAddDomain = computed(() => domainInput.value.trim() !== "" && !isSaving.value);
const filteredDomains = computed(() => filterAssetSourceDomains(domains.value, filterInput.value));

onMounted(loadDomains);

async function loadDomains() {
  try {
    const preferences = await loadAssetSourcePreferences();

    domains.value = preferences.domains;
    errorMessage.value = "";
  } catch {
    errorMessage.value = "Domain list unavailable.";
  }
}

async function addDomain() {
  if (!canAddDomain.value) {
    return;
  }

  isSaving.value = true;

  try {
    const preferences = await addAssetSourceDomain(domainInput.value);

    domains.value = preferences.domains;
    domainInput.value = "";
    errorMessage.value = "";
  } catch {
    errorMessage.value = "Enter a valid HTTP(S) domain.";
  } finally {
    isSaving.value = false;
  }
}

async function removeDomain(domain) {
  isSaving.value = true;

  try {
    const preferences = await removeAssetSourceDomain(domain);

    domains.value = preferences.domains;
    errorMessage.value = "";
  } catch {
    errorMessage.value = "Domain list unavailable.";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <section class="flex h-full min-h-0 w-full max-w-2xl flex-col gap-4">
    <form class="max-w-md" @submit.prevent="addDomain">
      <FieldGroup class="gap-3">
        <Field class="gap-1.5" :data-invalid="errorMessage !== '' || undefined">
          <FieldLabel for="atlas-source-domain">
            Domain
          </FieldLabel>
          <div class="flex gap-2">
            <Input
              id="atlas-source-domain"
              v-model="domainInput"
              autocomplete="url"
              class="h-7 text-sm"
              placeholder="reddit.com"
              :aria-invalid="errorMessage !== '' || undefined"
            />
            <Button type="submit" size="sm" :disabled="!canAddDomain">
              <Plus data-icon="inline-start" />
              Add
            </Button>
          </div>
          <FieldDescription v-if="errorMessage !== ''" class="text-xs">
            {{ errorMessage }}
          </FieldDescription>
        </Field>
        <Field class="gap-1.5">
          <FieldLabel for="atlas-source-filter">
            Filter
          </FieldLabel>
          <Input
            id="atlas-source-filter"
            v-model="filterInput"
            autocomplete="off"
            class="h-7 text-sm"
            placeholder="Filter domains"
          />
        </Field>
      </FieldGroup>
    </form>

    <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
      <div
        v-if="domains.length === 0"
        class="flex h-full min-h-32 items-center justify-center px-3 py-8 text-sm text-muted-foreground"
      >
        <span>
          No domains added.
        </span>
      </div>
      <div
        v-else-if="filteredDomains.length === 0"
        class="flex h-full min-h-32 items-center justify-center px-3 py-8 text-sm text-muted-foreground"
      >
        <span>
          No matching domains.
        </span>
      </div>
      <ul v-else aria-label="Domains">
        <li
          v-for="domain in filteredDomains"
          :key="domain"
          class="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0"
        >
          <span class="min-w-0 truncate text-sm font-medium">
            {{ domain }}
          </span>
          <span class="shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :disabled="isSaving"
              :aria-label="`Remove ${domain}`"
              :title="`Remove ${domain}`"
              @click="removeDomain(domain)"
            >
              <Trash2 />
            </Button>
          </span>
        </li>
      </ul>
    </div>
  </section>
</template>
