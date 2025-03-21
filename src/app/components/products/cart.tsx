
import React, { useState } from 'react';
import { Button, ActionIcon, ScrollArea, Card, Text, Group, Modal, Divider, Stack} from '@mantine/core';

import Configuration from './configuration';
import { IconX, IconPencil} from '@tabler/icons-react';

const Cart = ({ products, setProducts }) => {
  
    const handleRemove = (id) => {
      const updatedProducts = { ...products };
      delete updatedProducts[id];
      setProducts(updatedProducts);
    };

    const [modalOpen, setModalOpen] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState(null);
    
    const openModal = (id) => {
      setSelectedProduct(id);
      setModalOpen(true);
    };

    const handleEdit = (value) => {
        setModalOpen(false);
        handleRemove(selectedProduct);
        setProducts((prev) => ({
          ...prev,
          [selectedProduct]: value,
        }));
      };

    console.log(products);
  
    const rows = Object.keys(products).map((id) => (
        <>
        <Card padding='xs' shadow='xs' radius='md' key={id}>
            <Card.Section w='100%'>
                <Group justify='space-between' mt="xs" mb="xs">
                    <Text size='xl'>{products[id].product}</Text>
                    <Group>
                    {/* <ActionIcon color="green" onClick={() => openModal(id)} size="lg"><IconPencil/></ActionIcon> */}
                    <ActionIcon color="red" onClick={() => handleRemove(id)} size="lg"><IconX/></ActionIcon>
                    </Group>
                </Group>
            </Card.Section>
            <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="Edit">
                {selectedProduct !== null && (
                    <Configuration apiPath="/api/py/products/configuration" selectedProduct={products[selectedProduct]} submitTarget={handleEdit}  /> //initial={products[selectedProduct]}
                )}
            </Modal>
            <Stack maw='90%' p='' m='' gap='xs'>
              {Object.entries(products[id]).map(([subKey, subValue]) => (
                subKey !== 'product' && (
                  <Text size='xs' p='' m='' key={subKey} lineClamp={1}>{subKey}: {JSON.stringify(subValue)}</Text>
                )
              ))}
            </Stack>
      </Card>
       <Divider my="md" />
       </>
    ));
    
    return (
      <Card shadow="sm" padding="lg" radius="md" withBorder h="60vh" w="25vw" mih="200px" maw="400px">
        <ScrollArea h='inherit' type="always">
          {rows}
        </ScrollArea>        
      </Card>
    );
  };
  

  export default Cart;