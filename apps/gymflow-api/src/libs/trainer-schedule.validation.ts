import { BadRequestException } from '@nestjs/common';
import { TrainerScheduleInput } from './dto/trainer-schedule/trainer-schedule.input';
import {
	TrainerScheduleDayOfWeek,
	TRAINER_SCHEDULE_TIME_PATTERN,
	trainerScheduleWeekdays,
} from './enums/trainer-schedule.enum';

interface ScheduleDayValues {
	dayOfWeek?: unknown;
	isAvailable?: unknown;
	startTime?: unknown;
	endTime?: unknown;
}

export function assertTrainerScheduleDay(day: ScheduleDayValues): void {
	if (!day || !Object.values(TrainerScheduleDayOfWeek).includes(day.dayOfWeek as TrainerScheduleDayOfWeek))
		throw new BadRequestException('Invalid schedule weekday');
	if (typeof day.isAvailable !== 'boolean') throw new BadRequestException('Schedule availability must be boolean');
	const hasStart = day.startTime != null;
	const hasEnd = day.endTime != null;
	if (hasStart !== hasEnd) throw new BadRequestException('Provide both schedule times or neither');
	if (day.isAvailable || hasStart) {
		if (
			typeof day.startTime !== 'string' ||
			day.startTime.length !== 5 ||
			!TRAINER_SCHEDULE_TIME_PATTERN.test(day.startTime) ||
			typeof day.endTime !== 'string' ||
			day.endTime.length !== 5 ||
			!TRAINER_SCHEDULE_TIME_PATTERN.test(day.endTime)
		)
			throw new BadRequestException('Schedule times must use strict 24-hour HH:mm');
		if (day.startTime >= day.endTime) throw new BadRequestException('Schedule startTime must be before endTime');
	}
}

export function assertWeeklyTrainerSchedule(input: TrainerScheduleInput): void {
	if (!input || !Array.isArray(input.days) || input.days.length !== trainerScheduleWeekdays.length)
		throw new BadRequestException('Provide exactly seven schedule weekdays');
	const weekdays = new Set<TrainerScheduleDayOfWeek>();
	for (const day of input.days) {
		assertTrainerScheduleDay(day);
		if (weekdays.has(day.dayOfWeek)) throw new BadRequestException('Duplicate schedule weekday');
		weekdays.add(day.dayOfWeek);
	}
}
