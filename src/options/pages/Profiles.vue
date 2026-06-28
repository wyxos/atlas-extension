<script setup>
import { computed, onMounted, ref } from "vue";
import { ImageIcon, Link2, Plus, Trash2 } from "@lucide/vue";
import { Button } from "@ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@ui/field";
import { Input } from "@ui/input";
import {
  addAssetSourceDomain,
  createDefaultAssetSourcePreferences,
  filterAssetSourceDomains,
  imageSourcePreferenceValues,
  loadAssetSourcePreferences,
  normalizeAssetSourceDomain,
  removeAssetSourceDomain,
  setAssetImageSourcePreference,
} from "../../shared/asset-source-preferences";

const domainInput = ref("");
const filterInput = ref("");
const preferences = ref(createDefaultAssetSourcePreferences());
const activeDomain = ref(null);
const selectedProfileTab = ref("asset");
const errorMessage = ref("");
const isSaving = ref(false);

const profileTabs = [
  {
    icon: ImageIcon,
    key: "asset",
    label: "Asset",
  },
  {
    icon: Link2,
    key: "referrer",
    label: "Referrer",
  },
];
const imageSourceOptions = [
  {
    label: "src",
    value: imageSourcePreferenceValues.src,
  },
  {
    label: "Highest srcset",
    value: imageSourcePreferenceValues.highestSrcset,
  },
];

const domains = computed(() => preferences.value.domains);
const canAddDomain = computed(() => domainInput.value.trim() !== "" && !isSaving.value);
const filteredDomains = computed(() => filterAssetSourceDomains(domains.value, filterInput.value));
const profilesByDomain = computed(() => new Map(
  preferences.value.profiles.map((profile) => [profile.domain, profile]),
));
const selectedProfile = computed(() => {
  if (activeDomain.value === null) {
    return null;
  }

  return profilesByDomain.value.get(activeDomain.value) ?? null;
});
const imageSourcePreference = computed(() => (
  selectedProfile.value?.asset.imageSourcePreference ?? imageSourcePreferenceValues.src
));

onMounted(loadDomains);

async function loadDomains() {
  try {
    const loadedPreferences = await loadAssetSourcePreferences();

    applyPreferences(loadedPreferences);
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
    const normalizedDomain = normalizeAssetSourceDomain(domainInput.value);
    const nextPreferences = await addAssetSourceDomain(domainInput.value);

    applyPreferences(nextPreferences, normalizedDomain);
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
    const nextPreferences = await removeAssetSourceDomain(domain);

    applyPreferences(nextPreferences);
    errorMessage.value = "";
  } catch {
    errorMessage.value = "Domain list unavailable.";
  } finally {
    isSaving.value = false;
  }
}

async function setImageSourcePreference(value) {
  if (activeDomain.value === null || imageSourcePreference.value === value) {
    return;
  }

  isSaving.value = true;

  try {
    const nextPreferences = await setAssetImageSourcePreference(activeDomain.value, value);

    applyPreferences(nextPreferences, activeDomain.value);
    errorMessage.value = "";
  } catch {
    errorMessage.value = "Profile rules unavailable.";
  } finally {
    isSaving.value = false;
  }
}

function applyPreferences(nextPreferences, preferredDomain = activeDomain.value) {
  preferences.value = nextPreferences;

  const normalizedPreferredDomain = normalizeAssetSourceDomain(preferredDomain);

  if (
    normalizedPreferredDomain !== null
    && nextPreferences.domains.includes(normalizedPreferredDomain)
  ) {
    activeDomain.value = normalizedPreferredDomain;

    return;
  }

  activeDomain.value = nextPreferences.domains[0] ?? null;
}

function selectProfile(domain) {
  activeDomain.value = domain;
}
</script>

<template>
  <section class="grid h-full min-h-0 w-full grid-cols-[minmax(18rem,28rem)_minmax(0,1fr)] gap-5 max-lg:grid-cols-1">
    <aside class="flex min-h-0 min-w-0 flex-col gap-4">
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
            class="flex min-h-11 items-center gap-2 border-b border-l-2 border-b-border px-2 py-1.5 last:border-b-0"
            :class="domain === activeDomain ? 'border-l-primary bg-secondary text-foreground' : 'border-l-transparent text-muted-foreground hover:bg-muted/40'"
          >
            <button
              type="button"
              class="min-w-0 flex-1 truncate px-1 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-current="domain === activeDomain ? 'true' : undefined"
              @click="selectProfile(domain)"
            >
              {{ domain }}
            </button>
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
    </aside>

    <section class="flex min-h-0 min-w-0 flex-col border-l border-border pl-5 max-lg:border-l-0 max-lg:pl-0">
      <div
        v-if="selectedProfile === null"
        class="flex h-full min-h-32 items-center justify-center text-sm text-muted-foreground"
      >
        <span>
          No profile selected.
        </span>
      </div>
      <div v-else class="flex h-full min-h-0 min-w-0 flex-col gap-4">
        <header class="flex shrink-0 items-center justify-between gap-3">
          <h2 class="min-w-0 truncate text-lg font-semibold text-regal-navy-100">
            {{ selectedProfile.domain }}
          </h2>
          <div class="flex shrink-0 gap-1" role="tablist" aria-label="Profile rule sections">
            <Button
              v-for="tab in profileTabs"
              :key="tab.key"
              type="button"
              size="sm"
              :variant="selectedProfileTab === tab.key ? 'secondary' : 'ghost'"
              :aria-selected="selectedProfileTab === tab.key"
              role="tab"
              @click="selectedProfileTab = tab.key"
            >
              <component :is="tab.icon" data-icon="inline-start" />
              {{ tab.label }}
            </Button>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <section
            v-if="selectedProfileTab === 'asset'"
            class="flex max-w-2xl flex-col gap-4"
            aria-label="Asset rules"
          >
            <FieldGroup class="gap-3">
              <Field class="gap-2">
                <FieldLabel>
                  Image source
                </FieldLabel>
                <div class="grid max-w-lg grid-cols-2 gap-2">
                  <Button
                    v-for="option in imageSourceOptions"
                    :key="option.value"
                    type="button"
                    class="justify-start"
                    :variant="imageSourcePreference === option.value ? 'secondary' : 'outline'"
                    :aria-pressed="imageSourcePreference === option.value"
                    :disabled="isSaving"
                    @click="setImageSourcePreference(option.value)"
                  >
                    {{ option.label }}
                  </Button>
                </div>
              </Field>
            </FieldGroup>
          </section>

          <section
            v-else
            class="flex h-full min-h-32 items-center justify-center text-sm text-muted-foreground"
            aria-label="Referrer rules"
          >
            <span>
              No referrer rules configured.
            </span>
          </section>
        </div>
      </div>
    </section>
  </section>
</template>
