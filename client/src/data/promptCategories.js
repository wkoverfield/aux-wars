/**
 * Prompt categories with organized prompts for better UX
 */
export const promptCategories = [
  {
    id: 'vibes',
    name: 'Vibes & Moods',
    icon: '✨',
    prompts: [
      "This song makes me feel like the main character.",
      "The soundtrack to a late-night drive.",
      "A song that instantly boosts your confidence.",
      "This song would play in the background of my villain arc.",
      "A song that could make me cry on the right day.",
      "A song that makes you feel unstoppable."
    ]
  },
  {
    id: 'party',
    name: 'Party & Energy',
    icon: '🎉',
    prompts: [
      "The perfect song to play while getting ready to go out.",
      "This song could start a mosh pit.",
      "The ultimate cookout anthem.",
      "A song that instantly hypes up the whole room.",
      "A song that just feels like summertime."
    ]
  },
  {
    id: 'memories',
    name: 'Memories & Stories',
    icon: '💭',
    prompts: [
      "This song makes me wanna text my ex (or block them).",
      "A song that defines high school memories.",
      "This song is pure nostalgia.",
      "If life had a montage, this song would play in mine."
    ]
  }
];

/**
 * Get all prompts as a flat array
 */
export const getAllPrompts = () => {
  return promptCategories.flatMap(category => category.prompts);
};

/**
 * Get prompts organized by category
 */
export const getPromptsByCategory = () => {
  return promptCategories.reduce((acc, category) => {
    acc[category.id] = category.prompts;
    return acc;
  }, {});
};