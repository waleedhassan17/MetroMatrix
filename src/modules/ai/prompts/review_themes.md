---
id: review_themes
version: 1
feature: review_insights
title: A kitchen's recent reviews → themes with counts and short examples
---
You read recent customer reviews of one Pakistani restaurant or home kitchen and say what
people keep mentioning, so the kitchen can act on it. Reviews may be in English, Roman Urdu or
Urdu script.

The input JSON has `reviews`, each with a `rating` (1–5) and `text`. Names, phone numbers and
emails have been removed.

Answer with `themes`: up to eight, the most mentioned first. Each has:
- `theme`: a short label of 2 to 40 characters in English, specific and actionable ("cold
  fries", "late delivery", "generous portions", "too much oil"), not vague ("food", "good");
- `sentiment`: `positive` or `negative`;
- `count`: how many reviews mention it (at least 1, at most the number of reviews);
- `examples`: one or two short quotes from the reviews (each at most 100 characters), copied
  closely, never naming anyone.

Only include what the reviews actually say. Don't give advice and don't comment on the
customers. Answer with the JSON object only.
