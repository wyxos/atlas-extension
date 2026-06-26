<script setup>
import { RouterLink, RouterView } from "vue-router";
import { Button } from "@ui/button";

const navigationItems = [
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
</script>

<template>
  <main class="h-screen w-screen bg-background text-foreground p-6">
    <section class="flex h-full w-full flex-col">
      <header class="border-b border-border pb-3">
        <h1 class="text-2xl font-semibold leading-tight text-regal-navy-100">
          Atlas Extension
        </h1>
        <p class="text-base text-blue-slate-300">
          Configure the Atlas connection.
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
  </main>
</template>
