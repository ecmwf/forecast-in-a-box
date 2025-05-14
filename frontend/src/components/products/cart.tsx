
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.


import React, { useState } from 'react';
import { Button, ActionIcon, ScrollArea, Card, Text, Group, Paper, Modal, Divider, Stack, Collapse} from '@mantine/core';

import Configuration from './configuration';
import { IconX, IconChevronRight, IconChevronDown} from '@tabler/icons-react';

import {CategoriesType, ProductSpecification} from '../interface'
import sha256 from 'crypto-js/sha256';


interface CartProps {
    products: Record<string, ProductSpecification>;
    disable_delete?: boolean;
    setProducts: (products: Record<string, ProductSpecification>) => void;
}


function Cart({products, disable_delete, setProducts}: CartProps) {
    const handleRemove = (id: string) => {
      const updatedProducts = { ...products };
      delete updatedProducts[id];
      setProducts(updatedProducts);
    };

    const [modalOpen, setModalOpen] = useState<boolean>(false);
    const [selectedProduct, setSelectedProduct] = useState<string>("");
    
    const openModal = (id: string) => {
      setSelectedProduct(id);
      setModalOpen(true);
    };

    const handleEdit = (conf: ProductSpecification) => {
        setModalOpen(false);
        handleRemove(selectedProduct);

        setProducts({
          ...products,
          [sha256(JSON.stringify(conf)).toString()]: conf,
      });
      };
      const [expanded, setExpanded] = useState<Record<string, boolean>>(
        Object.keys(products).reduce((acc, id) => {
          acc[id] = Object.keys(products).length > 6 ? false : true; 
          return acc;
        }, {} as Record<string, boolean>)
      );

      const toggleExpanded = (id: string) => {
        setExpanded((prev) => ({
        ...prev,
        [id]: !prev[id],
        }));
      };
    const rows = Object.keys(products).map((id) => (
        <Card padding='xs' shadow='xs' radius='md' key={id}>
            <Card.Section w='100%'>
                <Group justify='space-between' mt="" mb="" wrap='nowrap'>
                    <Group>
                      <ActionIcon 
                            color="outline" 
                            c='blue'
                            onClick={() => {toggleExpanded(id);}} 
                            size="xs"
                          >
                            {expanded[id] ? <IconChevronRight/> : <IconChevronDown/>}
                      </ActionIcon>
                      <Text size='sm'>{products[id].product}</Text>
                    </Group>
                    <Group>
                    {/* <ActionIcon color="green" onClick={() => openModal(id)} size="lg"><IconPencil/></ActionIcon> */}
                    {!  disable_delete && (
                      <ActionIcon color="red" onClick={() => handleRemove(id)} size="md"><IconX/></ActionIcon>
                    )}
                    </Group>
                </Group>
            </Card.Section>
            {/* <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="Edit">
                {selectedProduct !== null && (
                    <Configuration selectedProduct={products[selectedProduct].product} submitTarget={handleEdit}  /> //initial={products[selectedProduct]}
                )}
            </Modal> */}

            <Collapse in={expanded[id] || Object.keys(products).length > 6 ? false : true}>
              <Stack maw='90%' p='' m='xs' gap='xs' pl='xl'>
                {Object.entries(products[id].specification).map(([subKey, subValue]) => (
                  subKey !== 'product' && (
                    <Text size='xs'  m='' key={subKey} lineClamp={1}>{subKey}: {JSON.stringify(subValue)}</Text>
                  )
                ))}
              </Stack>
            </Collapse>
      </Card>
    ));
    
    return (
      <Paper shadow="sm" mt='lg' p="sm" radius="md" withBorder w="inherit" h='90%' mih="10vh">
        <ScrollArea.Autosize mah="90%" type='always'>
          {rows}
        </ScrollArea.Autosize>
      </Paper>
    );
  };
  

  export default Cart;