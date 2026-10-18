import { Ban, Heart, Smile, ThumbsUp } from '@lucide/vue';

// Atlas Desktop reaction types (extension_assets/reaction.rs validate_reaction)
// in the order the asset badge shows them.
export const reactionOptions = Object.freeze([
  { icon: Heart, label: 'Love', type: 'love' },
  { icon: ThumbsUp, label: 'Like', type: 'like' },
  { icon: Ban, label: 'Blacklist', type: 'blacklist' },
  { icon: Smile, label: 'Funny', type: 'funny' },
]);
