import { BadRequestException } from '@nestjs/common';
import { TrainerApplicationInput } from './dto/trainer-application/trainer-application.input';
import { ProgramCategory } from './enums/program.enum';

export function normalizeTrainerApplicationInput(input: TrainerApplicationInput): TrainerApplicationInput {
	if (!input || typeof input !== 'object') throw new BadRequestException('Invalid trainer application');
	const text = (value: unknown, label: string, min: number, max: number): string => {
		if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
			throw new BadRequestException(label + ' must contain ' + min + ' to ' + max + ' characters');
		return value.trim();
	};
	const fullName = text(input.fullName, 'Full name', 3, 100);
	const experienceSummary = text(input.experienceSummary, 'Experience summary', 1, 1000);
	const bio = text(input.bio, 'Bio', 1, 2000);
	if (
		!Array.isArray(input.categories) ||
		!input.categories.length ||
		input.categories.length > Object.values(ProgramCategory).length ||
		new Set(input.categories).size !== input.categories.length ||
		input.categories.some((category) => !Object.values(ProgramCategory).includes(category))
	)
		throw new BadRequestException('Provide unique valid program categories');
	if (
		input.previousApplicationId != null &&
		(typeof input.previousApplicationId !== 'string' || !/^[a-f\d]{24}$/i.test(input.previousApplicationId))
	)
		throw new BadRequestException('Invalid previous application ID');
	return {
		fullName,
		categories: [...input.categories],
		experienceSummary,
		bio,
		...(input.previousApplicationId != null ? { previousApplicationId: input.previousApplicationId } : {}),
	};
}
