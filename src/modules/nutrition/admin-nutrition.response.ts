import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shapes for admin-nutrition.controller.ts (Swagger only), checked
 * against real responses from the e2e suites.
 */

export class AdminNutritionRemoveView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminNutritionListViewPer100g {
  @ApiProperty({ type: 'integer' })
  kcal!: number;
  @ApiProperty({ type: Number })
  proteinG!: number;
  @ApiProperty({ type: Number })
  carbsG!: number;
  @ApiProperty({ type: Number })
  fatG!: number;
  @ApiProperty({ type: Number })
  fibreG!: number;
  @ApiProperty({ type: 'integer' })
  sodiumMg!: number;
}

export class AdminNutritionListView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  key!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  nameUr!: string | null;
  @ApiProperty({ type: String })
  group!: string;
  @ApiProperty({ type: () => AdminNutritionListViewPer100g })
  per100g!: AdminNutritionListViewPer100g;
  @ApiProperty({ type: 'integer', nullable: true })
  pieceGrams!: number | null;
  @ApiProperty({ type: String })
  source!: string;
  @ApiProperty({ type: 'integer' })
  fdcId!: number;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
  @ApiProperty({ type: [String] })
  canonicals!: string[];
}

export class AdminNutritionUpdateViewPer100g {
  @ApiProperty({ type: 'integer' })
  kcal!: number;
  @ApiProperty({ type: Number })
  proteinG!: number;
  @ApiProperty({ type: Number })
  carbsG!: number;
  @ApiProperty({ type: Number })
  fatG!: number;
  @ApiProperty({ type: 'integer' })
  fibreG!: number;
  @ApiProperty({ type: 'integer' })
  sodiumMg!: number;
}

export class AdminNutritionUpdateView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  key!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  nameUr!: string;
  @ApiProperty({ type: String })
  group!: string;
  @ApiProperty({ type: () => AdminNutritionUpdateViewPer100g })
  per100g!: AdminNutritionUpdateViewPer100g;
  @ApiProperty({ type: String, nullable: true })
  pieceGrams!: string | null;
  @ApiProperty({ type: String })
  source!: string;
  @ApiProperty({ type: 'integer' })
  fdcId!: number;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
}

export class AdminNutritionCreateViewPer100g {
  @ApiProperty({ type: 'integer' })
  kcal!: number;
  @ApiProperty({ type: 'integer' })
  proteinG!: number;
  @ApiProperty({ type: 'integer' })
  carbsG!: number;
  @ApiProperty({ type: 'integer' })
  fatG!: number;
  @ApiProperty({ type: 'integer' })
  fibreG!: number;
  @ApiProperty({ type: 'integer' })
  sodiumMg!: number;
}

export class AdminNutritionCreateView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  key!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  nameUr!: string | null;
  @ApiProperty({ type: String })
  group!: string;
  @ApiProperty({ type: () => AdminNutritionCreateViewPer100g })
  per100g!: AdminNutritionCreateViewPer100g;
  @ApiProperty({ type: String, nullable: true })
  pieceGrams!: string | null;
  @ApiProperty({ type: String })
  source!: string;
  @ApiProperty({ type: String, nullable: true })
  fdcId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
}

export class AdminNutritionActivateView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminNutritionImportViewErrorsItem {
  @ApiProperty({ type: 'integer' })
  line!: number;
  @ApiProperty({ type: String })
  error!: string;
}

export class AdminNutritionImportView {
  @ApiProperty({ type: 'integer' })
  inserted!: number;
  @ApiProperty({ type: 'integer' })
  updated!: number;
  @ApiProperty({ type: 'integer' })
  rejected!: number;
  @ApiProperty({ type: () => [AdminNutritionImportViewErrorsItem] })
  errors!: AdminNutritionImportViewErrorsItem[];
}
