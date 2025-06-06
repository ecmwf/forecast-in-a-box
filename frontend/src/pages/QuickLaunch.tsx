
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { useEffect, useState } from 'react';
import MainLayout from '../layouts/MainLayout';

import {Card, Title, Text, Space, Group, Button, Container, Combobox, useCombobox, InputBase, Input} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { DatePicker, DatePickerInput } from '@mantine/dates';
import dayjs from 'dayjs';

import useKeyboardShortcuts from '../hooks/keyboardShortcuts';


const times = [
  'T00',
  'T06',
  'T12',
  'T18',
];

export default function QuickLaunch() { 

    const [date, setDate] = useState(new Date());
    const [timeValue, setTimeValue] = useState<string | null>('T00');
    const combobox = useCombobox({
        onDropdownClose: () => combobox.resetSelectedOption(),
    });
    // Track last scrub time and count
    const [scrubInfo, setScrubInfo] = useState({ last: 0, count: 0 });

    const scrubDate = (delta) => {
        const now = Date.now();
        let count = scrubInfo.count;
        if (now - scrubInfo.last < 50) {
            count += 1;
        } else {
            count = 1;
        }
        setScrubInfo({ last: now, count });

        if (date) {
            let newDate;
            // If pressed quickly 3 or more times, change month
            if (count >= 3) {
                newDate = dayjs(date).add(delta, 'month');
            } else {
                newDate = dayjs(date).add(delta, 'day');
            }
            const today = dayjs().startOf('day');
            const minDate = dayjs(new Date(2010, 0, 1));
            if (newDate.isAfter(today)) {
                setDate(today.toDate());
            } else if (newDate.isBefore(minDate)) {
                setDate(minDate.toDate());
            } else {
                setDate(newDate.toDate());
            }
        }
    };

    const notification = (key) => {
        showNotification({
            id: `action-triggered-${crypto.randomUUID()}`,
            position: 'top-right',
            autoClose: 3000,
            title: "Action Triggered",
            message: `Key ${key} was pressed. This is a placeholder for an action.`,
            color: 'blue',
            loading: false,
        });
    };

    useKeyboardShortcuts({
        F13: () => notification('F13'),
        // F14: () => notification('F14'),
        // F15: () => notification('F15'),
        F16: () => notification('F16'),
        F17: () => notification('F17'),
        F20: () => notification('F20'),
        Enter: () => notification('Enter'),

        F18: () => scrubDate(-1),
        F19: () => scrubDate(1),
    });

    const timeOptions = times.map((item) => (
        <Combobox.Option value={item} key={item}>
            {item}
        </Combobox.Option>
    ));

  return (
    <MainLayout>
        <Container size="lg" p='md'>
        <Space h="md" />
        <Card shadow="sm" p="lg" radius="md" withBorder>
        <Card.Section p='md'>
            <Title order={2}>Quick Launch</Title>
            <Text size="sm" c="dimmed" pt='xs'>
                Use the keyboard shortcuts to quickly navigate and configure the system.
            </Text>
        </Card.Section>
        
        <Title order={3} pt='md'>Initial Conditions</Title>
        <Group grow justify='space-between' align='center' pt='md'>
            <DatePickerInput
                value={date}
                onChange={(value) => setDate(value ? new Date(value) : null)}
                placeholder="Pick a date"
                minDate={new Date(2010, 0, 1)}
                maxDate={new Date()}
            />
            <Combobox
                store={combobox}
                withinPortal={false}
                onOptionSubmit={(val) => {
                    setTimeValue(val);
                    combobox.closeDropdown();
                }}
            >
            <Combobox.Target>
                <InputBase
                    component="button"
                    type="button"
                    pointer
                    rightSection={<Combobox.Chevron />}
                    onClick={() => combobox.toggleDropdown()}
                    rightSectionPointerEvents="none"
                >
                {timeValue || <Input.Placeholder>Pick value</Input.Placeholder>}
                </InputBase>
            </Combobox.Target>

            <Combobox.Dropdown>
                <Combobox.Options>{timeOptions}</Combobox.Options>
            </Combobox.Dropdown>
            </Combobox>

        </Group>
        <Space h="md" />
        <Title order={3}>Keyboard Shortcuts</Title>
        <Group justify='space-between' grow align='center' pt='md'>
            <Button>
                Button 1
            </Button>
            <Button>
                Button 2
            </Button>
            <Button>
                Button 3
            </Button>
        </Group>
        <Space h="md" />
        <Button
            title='Launch the application'
            variant="filled"
            fullWidth
            color='red'
        >
            <Title mt='xl' mb='xl' order={2} c='white'>Launch</Title>
        </Button>
        </Card>
        </Container>
   </MainLayout>
  );
};

