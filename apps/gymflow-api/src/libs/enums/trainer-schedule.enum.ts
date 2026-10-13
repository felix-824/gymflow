import { registerEnumType } from '@nestjs/graphql';

export enum TrainerScheduleDayOfWeek {
	MON = 'MON',
	TUE = 'TUE',
	WED = 'WED',
	THU = 'THU',
	FRI = 'FRI',
	SAT = 'SAT',
	SUN = 'SUN',
}
registerEnumType(TrainerScheduleDayOfWeek, { name: 'TrainerScheduleDayOfWeek' });

export const trainerScheduleWeekdays = [
	TrainerScheduleDayOfWeek.MON,
	TrainerScheduleDayOfWeek.TUE,
	TrainerScheduleDayOfWeek.WED,
	TrainerScheduleDayOfWeek.THU,
	TrainerScheduleDayOfWeek.FRI,
	TrainerScheduleDayOfWeek.SAT,
	TrainerScheduleDayOfWeek.SUN,
] as const;
export const TRAINER_SCHEDULE_TIMEZONE = 'Asia/Seoul';
export const TRAINER_SCHEDULE_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
