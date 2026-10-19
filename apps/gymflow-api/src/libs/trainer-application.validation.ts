import { BadRequestException } from '@nestjs/common';
import { TrainerApplicationInput } from './dto/trainer-application/trainer-application.input';
import { ProgramCategory } from './enums/program.enum';
import {
	TrainerApplicationReview,
	TrainerApplicationsInquiry,
} from './dto/trainer-application/trainer-application-admin.input';
import { TrainerApplicationStatus } from './enums/trainer-application.enum';

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

export function assertTrainerApplicationsInquiry(input: TrainerApplicationsInquiry): void {
	if (
		!input ||
		!Number.isSafeInteger(input.page) ||
		input.page < 1 ||
		input.page > 2147483647 ||
		!Number.isSafeInteger(input.limit) ||
		input.limit < 1 ||
		input.limit > 100 ||
		!input.search ||
		typeof input.search !== 'object' ||
		Array.isArray(input.search) ||
		(input.search.status != null && !Object.values(TrainerApplicationStatus).includes(input.search.status))
	)
		throw new BadRequestException('Invalid trainer application inquiry');
}

export function normalizeTrainerApplicationReview(input: TrainerApplicationReview): TrainerApplicationReview {
	if (
		!input ||
		typeof input.applicationId !== 'string' ||
		!/^[a-f\d]{24}$/i.test(input.applicationId) ||
		![TrainerApplicationStatus.APPROVED, TrainerApplicationStatus.REJECTED].includes(input.decision)
	)
		throw new BadRequestException('Invalid trainer application review');
	if (input.decision === TrainerApplicationStatus.APPROVED) {
		if (input.rejectionReason !== undefined)
			throw new BadRequestException('Approval must not include a rejection reason');
		return { applicationId: input.applicationId, decision: input.decision };
	}
	if (
		typeof input.rejectionReason !== 'string' ||
		!input.rejectionReason.trim() ||
		input.rejectionReason.trim().length > 1000
	)
		throw new BadRequestException('Rejection reason must contain 1 to 1000 characters');
	return {
		applicationId: input.applicationId,
		decision: input.decision,
		rejectionReason: input.rejectionReason.trim(),
	};
}
