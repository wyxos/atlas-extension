<script setup>
import "vue-sonner/style.css";
import { RouterView } from "vue-router";
import { Toaster } from "@ui/sonner";
</script>

<template>
  <main class="min-h-screen w-full bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
    <section class="mx-auto w-full max-w-4xl">
      <header class="border-b border-border pb-4">
        <h1 class="text-2xl font-semibold leading-tight text-regal-navy-100">
          Atlas Extension
        </h1>
        <p class="mt-1 text-sm text-blue-slate-300">
          Desktop connection diagnostics for this browser.
        </p>
      </header>

      <div class="pt-5">
        <RouterView />
      </div>
    </section>
    <Toaster rich-colors position="bottom-right" />
  </main>
</template>
