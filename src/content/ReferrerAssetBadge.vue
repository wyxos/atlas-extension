<script setup>
import {
  Ban,
  ExternalLink,
  Focus,
  Heart,
  Smile,
  ThumbsUp,
} from "@lucide/vue";

defineProps({
  badge: {
    type: Object,
    required: true,
  },
});

const iconSize = 30;

const reactions = {
  blacklist: {
    icon: Ban,
    label: "Blacklisted",
  },
  'current-page': {
    icon: Focus,
    label: "Current page",
  },
  funny: {
    icon: Smile,
    label: "Funny",
  },
  like: {
    icon: ThumbsUp,
    label: "Liked",
  },
  love: {
    icon: Heart,
    label: "Loved",
  },
  'opened-elsewhere': {
    icon: ExternalLink,
    label: "Open in another tab",
  },
};

function statusFor(badge) {
  return reactions[badge.activeReaction ?? badge.referrerStatus] ?? reactions.like;
}

function statusTypeFor(badge) {
  return badge.activeReaction ?? badge.referrerStatus ?? 'like';
}

function progressStyle(badge) {
  return {
    width: `${badge.progressPercent}%`,
  };
}

function progressClass(badge) {
  return `atlas-static-progress-fill-${badge.progressTone}`;
}
</script>

<template>
  <div
    data-atlas-referrer-badge="true"
    :data-atlas-asset-source="badge.source"
    :style="badge.style"
  >
    <div class="atlas-referrer-status">
      <span
        class="atlas-referrer-reaction"
        :class="`atlas-referrer-reaction-${statusTypeFor(badge)}`"
        :aria-label="statusFor(badge).label"
        :title="statusFor(badge).label"
      >
        <component
          :is="statusFor(badge).icon"
          :size="iconSize"
          :stroke-width="2"
        />
      </span>
    </div>

    <div class="atlas-referrer-progress">
      <div
        class="atlas-static-progress-fill"
        :class="progressClass(badge)"
        :style="progressStyle(badge)"
      ></div>
    </div>
  </div>
</template>
