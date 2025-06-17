
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { Container, Group, Paper, SimpleGrid } from '@mantine/core';
import { Table, Loader, Center, Title, Progress, Button, Flex, Divider, Tooltip, FileButton, Menu, Burger, Modal, Text } from '@mantine/core';

import { ExecutionSpecification } from './interface';

import Cart from './products/cart';


const dictionaryAsGrid = (dictionary: Record<string, any>) => {
    return (
        <SimpleGrid cols={{ base: 1, sm: 3, lg: 3 }} spacing=''>
            {Object.entries(dictionary).map(([key, value]) => (
                <Paper shadow="" p="xs" key={key}>
                    <Title order={5}>{key}</Title>
                    <Text maw='80%' lineClamp={3} style={{ marginLeft: '10px' }}>{JSON.stringify(value, null, 2)}</Text>
                </Paper>
            ))}
        </SimpleGrid>
    );
}

type SummaryModalProps = {
    moreInfoSpec: ExecutionSpecification;
    showMoreInfo: boolean;
    setShowMoreInfo: (show: boolean) => void;
};

const SummaryModal = ({ moreInfoSpec, showMoreInfo, setShowMoreInfo }: SummaryModalProps) => {

    const job = moreInfoSpec.job;

    return (
        <Modal
            opened={showMoreInfo}
            onClose={() => setShowMoreInfo(false)}
            title="Job Configuration"
            size="lg"
        >
            {job && (
                <>
                    <Title order={3}>Model</Title>
                    {job.model && (
                        dictionaryAsGrid(job.model)
                    )}
                    <Title order={3}>Environment</Title>
                    {moreInfoSpec.environment && (
                        dictionaryAsGrid(moreInfoSpec.environment)
                    )}
                    <Title order={3}>Products</Title>
                    {job.products && job.products.length > 0 && (
                        <Cart
                            products={Object.fromEntries(
                                job.products.map((product: any, index: number) => [index.toString(), product])
                            )}
                            setProducts={(updatedProducts: Record<string, any>) => {
                                job.products = Object.values(updatedProducts);
                            }}
                            disable_delete={true}
                        />
                    )}
                </>
            )}
        </Modal>
    );
};

export default SummaryModal;