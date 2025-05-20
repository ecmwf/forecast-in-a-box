// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

import { IconChartScatter, IconListDetails, IconPointer } from '@tabler/icons-react';
import {
  Badge,
  Button,
  Card,
  Center,
  Container,
  Group,
  SimpleGrid,
  Space,
  Text,
  Title,
  useMantineTheme,
} from '@mantine/core';

import classes from './products.module.css';

import MainLayout from '../../layouts/MainLayout';


const interfaces = [
  {
    title: 'Standard',
    description:
      'Select from a standard list of products, making readable, comphrehensible plots.',
    icon: IconChartScatter,
    id: 'standard',
    status: 'alpha',
  },
  {
    title: 'Detailed',
    description:
      'Build a shopping cart out of all the products available, and then compute them.',
    icon: IconListDetails,
    id: 'detailed',
    status: 'beta',
  },
  {
    title: 'Interactive',
    description:
      'Spinup an interactive visualiser with ease.',
    icon: IconPointer,
    id: 'interactive',
    status: 'coming-soon',
  },
];

export default function ProductsCards() {
  const theme = useMantineTheme();
  const features = interfaces.map((feature) => (
    <Card
        key={feature.title}
        shadow="md"
        radius="md"
        className={classes.card}
        padding="xl"
        component="a"
        href={`/products/${feature.id}`}
        style={feature.status === 'coming-soon' ? { opacity: 0.6, color:'grey', pointerEvents: 'none' } : {}}
    >
        <Group justify="space-between" mb="xs">
            <feature.icon size={50} stroke={1.5} color={theme.colors.blue[6]} />
            <Badge variant="filled" size="sm">
                {feature.status}
            </Badge>
        </Group>
        <Text fz="lg" fw={500} className={classes.cardTitle} mt="md">
            {feature.title}
        </Text>
        <Text fz="sm" c="dimmed" mt="sm">
            {feature.description}
        </Text>
        <Space h="xs" />
    </Card>
  ));

  return (
    <MainLayout>
    <Container size="lg" py="xl">
      <Title order={2} className={classes.title} ta="center" mt="sm">
        Product Options
      </Title>

        <Center>
        <Text c="dimmed" className={classes.description} ta="center" mt="md">
            Choose the interface that fits your needs. All models are accessible through every interface.
        </Text>
      </Center>

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="xl" mt={50}>
        {features}
      </SimpleGrid>
    </Container>
    </MainLayout>
  );
}