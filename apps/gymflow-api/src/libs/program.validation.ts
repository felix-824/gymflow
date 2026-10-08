import { BadRequestException } from '@nestjs/common';
import { ProgramInput } from './dto/program/program.input';
import { ProgramCategory, ProgramLocation, ProgramType } from './enums/program.enum';

// Validate the merged document, including when only one related field changes.
export function assertProgram(input: ProgramInput): void {
	const fail = (message: string): never => {
		throw new BadRequestException(message);
	};
	if (!Object.values(ProgramType).includes(input.programType)) fail('Invalid program type');
	if (!Object.values(ProgramCategory).includes(input.programCategory)) fail('Invalid program category');
	if (!Object.values(ProgramLocation).includes(input.programLocation)) fail('Invalid program location');
	if (typeof input.programName !== 'string' || input.programName.trim().length < 3 || input.programName.length > 100)
		fail('Program name must contain 3?100 characters');
	for (const key of ['programPrice', 'programDuration', 'programCapacity'] as const) {
		if (!Number.isSafeInteger(input[key]) || input[key] < (key === 'programPrice' ? 0 : 1) || input[key] > 2147483647)
			fail('Invalid ' + key);
	}
	if (
		!Array.isArray(input.programImages) ||
		!input.programImages.length ||
		input.programImages.some((image) => typeof image !== 'string' || !image.trim() || image.length > 2048)
	)
		fail('Program images are required');
	if (
		input.programDesc != null &&
		(typeof input.programDesc !== 'string' || input.programDesc.length < 5 || input.programDesc.length > 500)
	)
		fail('Invalid program description');
	if (
		input.programAddress != null &&
		(typeof input.programAddress !== 'string' ||
			input.programAddress.trim().length < 3 ||
			input.programAddress.length > 100)
	)
		fail('Invalid program address');
	if (input.programType === ProgramType.ONLINE) {
		if (input.programLocation !== ProgramLocation.ONLINE) fail('Online programs require ONLINE location');
	} else {
		if (input.programLocation === ProgramLocation.ONLINE || !input.programAddress?.trim())
			fail('In-person programs require a physical location and address');
	}
	if (input.programType === ProgramType.PT_1ON1 && input.programCapacity !== 1) fail('PT_1ON1 capacity must be 1');
}
